use crate::{CoreError, Result, Tools};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoInfo {
    pub path: String,
    pub file_name: String,
    /// Seconds.
    pub duration: f64,
    /// Display width/height (rotation already applied).
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    pub video_codec: String,
    pub size_bytes: u64,
}

/// Run ffprobe on a file.
pub fn probe(tools: &Tools, path: &Path) -> Result<VideoInfo> {
    if !path.is_file() {
        return Err(CoreError::MissingMedia(path.display().to_string()));
    }
    let out = Command::new(&tools.ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
        .arg(path)
        .output()
        .map_err(|e| CoreError::Ffmpeg(format!("could not start ffprobe: {e}")))?;
    if !out.status.success() {
        let msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(CoreError::Invalid(format!(
            "This file does not look like a readable video. {}",
            first_line(&msg)
        )));
    }
    parse_probe(&String::from_utf8_lossy(&out.stdout), path)
}

fn first_line(s: &str) -> &str {
    s.lines().next().unwrap_or("")
}

/// Parse ffprobe JSON. Separated from `probe` so it can be unit tested.
pub fn parse_probe(json: &str, path: &Path) -> Result<VideoInfo> {
    let v: Value = serde_json::from_str(json)
        .map_err(|e| CoreError::Invalid(format!("unreadable ffprobe output: {e}")))?;
    let streams = v["streams"].as_array().cloned().unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1)
        .ok_or_else(|| CoreError::Invalid("This file has no video track.".into()))?;
    let has_audio = streams.iter().any(|s| s["codec_type"] == "audio");

    let mut width = video["width"].as_u64().unwrap_or(0) as u32;
    let mut height = video["height"].as_u64().unwrap_or(0) as u32;
    if width == 0 || height == 0 {
        return Err(CoreError::Invalid("The video track has no readable size.".into()));
    }
    if rotation_degrees(video).rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }

    let duration = num(&v["format"]["duration"])
        .or_else(|| num(&video["duration"]))
        .filter(|d| d.is_finite() && *d > 0.0)
        .ok_or_else(|| CoreError::Invalid("Could not determine the video duration.".into()))?;

    let size_bytes = num(&v["format"]["size"]).unwrap_or(0.0) as u64;
    let fps = video["avg_frame_rate"]
        .as_str()
        .and_then(parse_ratio)
        .or_else(|| video["r_frame_rate"].as_str().and_then(parse_ratio))
        .unwrap_or(0.0);

    Ok(VideoInfo {
        path: path.display().to_string(),
        file_name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        duration,
        width,
        height,
        fps,
        has_audio,
        video_codec: video["codec_name"].as_str().unwrap_or("unknown").to_string(),
        size_bytes,
    })
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn parse_ratio(s: &str) -> Option<f64> {
    let (a, b) = s.split_once('/')?;
    let (a, b): (f64, f64) = (a.parse().ok()?, b.parse().ok()?);
    if b == 0.0 {
        None
    } else {
        Some(a / b)
    }
}

fn rotation_degrees(stream: &Value) -> i64 {
    if let Some(list) = stream["side_data_list"].as_array() {
        for sd in list {
            if let Some(r) = num(&sd["rotation"]) {
                return r.round() as i64;
            }
        }
    }
    num(&stream["tags"]["rotate"]).map(|r| r.round() as i64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "streams": [
        {"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
         "avg_frame_rate":"30000/1001","disposition":{"attached_pic":0}},
        {"codec_type":"audio","codec_name":"aac"}
      ],
      "format": {"duration":"125.500000","size":"1048576"}
    }"#;

    #[test]
    fn parses_basic_video() {
        let i = parse_probe(SAMPLE, Path::new("/tmp/a.mp4")).unwrap();
        assert_eq!((i.width, i.height), (1920, 1080));
        assert!((i.duration - 125.5).abs() < 1e-9);
        assert!((i.fps - 29.97).abs() < 0.01);
        assert!(i.has_audio);
        assert_eq!(i.file_name, "a.mp4");
        assert_eq!(i.size_bytes, 1_048_576);
    }

    #[test]
    fn swaps_dimensions_for_rotated_phone_video() {
        let j = r#"{"streams":[{"codec_type":"video","codec_name":"hevc","width":1920,"height":1080,
          "avg_frame_rate":"30/1","side_data_list":[{"rotation":-90}]}],
          "format":{"duration":"10"}}"#;
        let i = parse_probe(j, Path::new("/tmp/p.mov")).unwrap();
        assert_eq!((i.width, i.height), (1080, 1920));
        assert!(!i.has_audio);
    }

    #[test]
    fn rejects_audio_only_files() {
        let j = r#"{"streams":[{"codec_type":"audio"}],"format":{"duration":"3"}}"#;
        assert!(parse_probe(j, Path::new("/tmp/a.mp3")).is_err());
    }

    #[test]
    fn rejects_zero_duration() {
        let j = r#"{"streams":[{"codec_type":"video","width":10,"height":10}],"format":{"duration":"0"}}"#;
        assert!(parse_probe(j, Path::new("/tmp/z.mp4")).is_err());
    }
}
