use crate::geometry::{crop_rect, Preset};
use crate::probe::{probe, VideoInfo};
use crate::{CoreError, Result, Tools};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

/// Shortest clip we will export, in seconds.
const MIN_CLIP_SECONDS: f64 = 0.5;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipSpec {
    pub name: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone)]
pub struct ExportRequest {
    pub input: PathBuf,
    pub out_dir: PathBuf,
    pub clip: ClipSpec,
    pub preset: Preset,
    /// 0.0..=1.0 crop position; 0.5 is centered.
    pub pan: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportResult {
    pub output_path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
}

/// Check a clip's time range against the source duration.
pub fn validate_clip(clip: &ClipSpec, source_duration: f64) -> Result<()> {
    if !clip.start.is_finite() || !clip.end.is_finite() {
        return Err(CoreError::Invalid("Clip times must be numbers.".into()));
    }
    if clip.start < 0.0 {
        return Err(CoreError::Invalid("The clip starts before the beginning of the video.".into()));
    }
    if clip.end <= clip.start {
        return Err(CoreError::Invalid("The out point must be after the in point.".into()));
    }
    if clip.end > source_duration + 0.05 {
        return Err(CoreError::Invalid(format!(
            "The clip ends at {:.2}s but the video is only {:.2}s long.",
            clip.end, source_duration
        )));
    }
    if clip.end - clip.start < MIN_CLIP_SECONDS {
        return Err(CoreError::Invalid(format!(
            "Clips must be at least {MIN_CLIP_SECONDS} seconds long."
        )));
    }
    Ok(())
}

/// Make a clip name safe to use as a file name.
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.') { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let limited: String = trimmed.chars().take(80).collect();
    if limited.is_empty() {
        "clip".to_string()
    } else {
        limited
    }
}

/// Free bytes on the volume holding `path` (None if it cannot be determined).
#[cfg(unix)]
#[allow(clippy::unnecessary_cast)]
pub fn available_space(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } == 0 {
        Some((s.f_bavail as u64).saturating_mul(s.f_frsize as u64))
    } else {
        None
    }
}

#[cfg(not(unix))]
pub fn available_space(_path: &Path) -> Option<u64> {
    None
}

/// Reserve a new, never-existing file name in `dir`. `create_new` makes the
/// reservation atomic, so an existing file (including the source) can never be
/// overwritten.
fn reserve_output(dir: &Path, base: &str) -> Result<PathBuf> {
    for n in 1..10_000u32 {
        let file = if n == 1 { format!("{base}.mp4") } else { format!("{base} ({n}).mp4") };
        let candidate = dir.join(file);
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(CoreError::Invalid("Too many files with the same name in the output folder.".into()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Encoder {
    X264,
    VideoToolbox,
}

fn pick_encoder(tools: &Tools) -> Result<Encoder> {
    let out = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| CoreError::Ffmpeg(format!("could not start ffmpeg: {e}")))?;
    let list = String::from_utf8_lossy(&out.stdout);
    if list.contains(" libx264 ") {
        Ok(Encoder::X264)
    } else if list.contains(" h264_videotoolbox ") {
        Ok(Encoder::VideoToolbox)
    } else {
        Err(CoreError::Ffmpeg("this FFmpeg build has no H.264 encoder".into()))
    }
}

fn build_args(
    input: &Path,
    output: &Path,
    clip: &ClipSpec,
    info: &VideoInfo,
    preset: Preset,
    pan: f64,
    encoder: Encoder,
) -> Vec<String> {
    let (tw, th) = preset.target_size(info.width, info.height);
    let c = crop_rect(info.width, info.height, tw, th, pan);
    let mut filter = String::new();
    if preset != Preset::Original {
        filter.push_str(&format!("crop={}:{}:{}:{},scale={}:{}:flags=lanczos,", c.w, c.h, c.x, c.y, tw, th));
    } else if (tw, th) != (info.width, info.height) {
        filter.push_str(&format!("crop={}:{}:0:0,", tw, th));
    }
    filter.push_str("setsar=1,format=yuv420p");

    let mut a: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(), // safe: we exclusively created this (empty) output file
        "-ss".into(),
        format!("{:.3}", clip.start),
        "-i".into(),
        input.display().to_string(),
        "-t".into(),
        format!("{:.3}", clip.end - clip.start),
        "-map".into(),
        "0:v:0".into(),
        "-map".into(),
        "0:a:0?".into(),
        "-vf".into(),
        filter,
    ];
    match encoder {
        Encoder::X264 => a.extend(
            ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"].map(String::from),
        ),
        Encoder::VideoToolbox => a.extend(["-c:v", "h264_videotoolbox", "-b:v", "10M"].map(String::from)),
    }
    a.extend(
        [
            "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-map_metadata", "-1",
            "-progress", "pipe:1", "-nostats", "-loglevel", "error",
        ]
        .map(String::from),
    );
    a.push(output.display().to_string());
    a
}

/// Export one clip. `on_progress` receives 0.0..=1.0 from FFmpeg's real
/// progress output. Set `cancel` to stop early (the partial file is removed).
pub fn export_clip(
    tools: &Tools,
    req: &ExportRequest,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(f64),
) -> Result<ExportResult> {
    let info = probe(tools, &req.input)?;
    validate_clip(&req.clip, info.duration)?;
    let duration = req.clip.end - req.clip.start;

    fs::create_dir_all(&req.out_dir)?;
    if !req.out_dir.is_dir() {
        return Err(CoreError::Invalid("The output location is not a folder.".into()));
    }
    if let Some(avail) = available_space(&req.out_dir) {
        let needed = (duration * 2_000_000.0) as u64 + 20_000_000;
        if avail < needed {
            return Err(CoreError::DiskSpace { needed_mb: needed / 1_000_000, available_mb: avail / 1_000_000 });
        }
    }

    let encoder = pick_encoder(tools)?;
    let output = reserve_output(&req.out_dir, &sanitize_file_name(&req.clip.name))?;
    let args = build_args(&req.input, &output, &req.clip, &info, req.preset, req.pan, encoder);

    let result = run_ffmpeg(tools, &args, duration, cancel, on_progress)
        .and_then(|_| verify(tools, &output, duration, req.preset, &info));
    match result {
        Ok(r) => Ok(r),
        Err(e) => {
            // Remove only the file we created for this export.
            let _ = fs::remove_file(&output);
            Err(e)
        }
    }
}

fn run_ffmpeg(
    tools: &Tools,
    args: &[String],
    duration: f64,
    cancel: &AtomicBool,
    on_progress: &mut dyn FnMut(f64),
) -> Result<()> {
    let mut child = Command::new(&tools.ffmpeg)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| CoreError::Ffmpeg(format!("could not start ffmpeg: {e}")))?;

    let mut stderr = child.stderr.take().expect("piped stderr");
    let err_thread = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });

    let stdout = child.stdout.take().expect("piped stdout");
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = err_thread.join();
            return Err(CoreError::Cancelled);
        }
        let micros = line
            .strip_prefix("out_time_us=")
            .or_else(|| line.strip_prefix("out_time_ms="))
            .and_then(|v| v.trim().parse::<f64>().ok());
        if let Some(us) = micros {
            on_progress(((us / 1_000_000.0) / duration).clamp(0.0, 1.0));
        }
    }

    let status = child.wait()?;
    let stderr_text = err_thread.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        return Err(CoreError::Cancelled);
    }
    if !status.success() {
        let tail: Vec<&str> = stderr_text.lines().rev().take(3).collect();
        let msg = tail.into_iter().rev().collect::<Vec<_>>().join(" ");
        return Err(CoreError::Ffmpeg(if msg.is_empty() { format!("exit status {status}") } else { msg }));
    }
    on_progress(1.0);
    Ok(())
}

fn verify(
    tools: &Tools,
    output: &Path,
    expected_duration: f64,
    preset: Preset,
    src: &VideoInfo,
) -> Result<ExportResult> {
    let meta = fs::metadata(output).map_err(|_| CoreError::Verify("the output file is missing".into()))?;
    if meta.len() == 0 {
        return Err(CoreError::Verify("the output file is empty".into()));
    }
    let info = probe(tools, output).map_err(|e| CoreError::Verify(format!("it cannot be opened ({e})")))?;
    let tolerance = (expected_duration * 0.05).max(0.5);
    if (info.duration - expected_duration).abs() > tolerance {
        return Err(CoreError::Verify(format!(
            "expected about {:.1}s but the file is {:.1}s long",
            expected_duration, info.duration
        )));
    }
    let (tw, th) = preset.target_size(src.width, src.height);
    if (info.width, info.height) != (tw, th) {
        return Err(CoreError::Verify(format!(
            "expected {tw}x{th} but the file is {}x{}",
            info.width, info.height
        )));
    }
    Ok(ExportResult {
        output_path: output.display().to_string(),
        duration: info.duration,
        width: info.width,
        height: info.height,
        size_bytes: meta.len(),
    })
}

/// Create a short synthetic test video (colour bars + tone). Used by tests and
/// the app's `--selftest` mode so the bundled FFmpeg can be verified.
pub fn generate_test_video(tools: &Tools, path: &Path, seconds: u32, width: u32, height: u32) -> Result<()> {
    let encoder = pick_encoder(tools)?;
    let codec: &[&str] = match encoder {
        Encoder::X264 => &["-c:v", "libx264", "-preset", "ultrafast"],
        Encoder::VideoToolbox => &["-c:v", "h264_videotoolbox", "-b:v", "4M"],
    };
    let status = Command::new(&tools.ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i"])
        .arg(format!("testsrc2=size={width}x{height}:rate=30:duration={seconds}"))
        .args(["-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:duration={seconds}"))
        .args(codec)
        .args(["-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"])
        .arg(path)
        .stdin(Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(CoreError::Ffmpeg("could not generate the test video".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(s: f64, e: f64) -> ClipSpec {
        ClipSpec { name: "c".into(), start: s, end: e }
    }

    #[test]
    fn validation_rejects_bad_ranges() {
        assert!(validate_clip(&clip(-1.0, 5.0), 60.0).is_err());
        assert!(validate_clip(&clip(5.0, 5.0), 60.0).is_err());
        assert!(validate_clip(&clip(6.0, 5.0), 60.0).is_err());
        assert!(validate_clip(&clip(50.0, 70.0), 60.0).is_err());
        assert!(validate_clip(&clip(1.0, 1.2), 60.0).is_err());
        assert!(validate_clip(&clip(f64::NAN, 3.0), 60.0).is_err());
        assert!(validate_clip(&clip(10.0, 20.0), 60.0).is_ok());
        assert!(validate_clip(&clip(0.0, 60.0), 60.0).is_ok());
    }

    #[test]
    fn file_names_are_sanitized() {
        let traversal = sanitize_file_name("../../etc/passwd");
        assert_eq!(traversal, "_.._etc_passwd");
        assert!(!traversal.contains('/') && !traversal.starts_with('.'));
        assert_eq!(sanitize_file_name("   "), "clip");
        assert_eq!(sanitize_file_name("Big idea: part 1/2"), "Big idea_ part 1_2");
        assert!(!sanitize_file_name("a/b").contains('/'));
        assert_eq!(sanitize_file_name(&"x".repeat(200)).len(), 80);
    }

    #[test]
    fn reserve_never_overwrites() {
        let d = tempfile::tempdir().unwrap();
        let a = reserve_output(d.path(), "clip").unwrap();
        let b = reserve_output(d.path(), "clip").unwrap();
        assert_ne!(a, b);
        assert!(b.file_name().unwrap().to_string_lossy().contains("(2)"));
    }

    #[test]
    fn args_contain_crop_for_vertical() {
        let info = VideoInfo {
            path: "/x.mp4".into(),
            file_name: "x.mp4".into(),
            duration: 60.0,
            width: 1920,
            height: 1080,
            fps: 30.0,
            has_audio: true,
            video_codec: "h264".into(),
            size_bytes: 1,
        };
        let a = build_args(Path::new("/x.mp4"), Path::new("/o.mp4"), &clip(10.0, 20.0), &info, Preset::Vertical, 0.5, Encoder::X264);
        let vf = &a[a.iter().position(|s| s == "-vf").unwrap() + 1];
        assert!(vf.starts_with("crop=606:1080:656:0,scale=1080:1920"));
        assert!(a.contains(&"10.000".to_string()) && a.contains(&"libx264".to_string()));
    }
}
