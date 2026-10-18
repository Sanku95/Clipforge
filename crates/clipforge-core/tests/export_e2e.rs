//! End-to-end tests against a real FFmpeg (found via CLIPFORGE_FFMPEG / PATH).
//! They generate a synthetic video, export real clips and verify the files.

use clipforge_core::*;
use std::sync::atomic::AtomicBool;

fn tools() -> Tools {
    Tools::locate().expect("ffmpeg/ffprobe must be available to run the end-to-end tests")
}

fn source(dir: &std::path::Path, t: &Tools) -> std::path::PathBuf {
    let p = dir.join("source.mp4");
    generate_test_video(t, &p, 8, 1280, 720).expect("generate test video");
    p
}

fn request(src: &std::path::Path, out: &std::path::Path, name: &str, s: f64, e: f64, preset: Preset) -> ExportRequest {
    ExportRequest {
        input: src.to_path_buf(),
        out_dir: out.to_path_buf(),
        clip: ClipSpec { name: name.into(), start: s, end: e },
        preset,
        pan: 0.5,
    }
}

#[test]
fn probe_reports_real_properties() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let src = source(d.path(), &t);
    let info = probe(&t, &src).unwrap();
    assert_eq!((info.width, info.height), (1280, 720));
    assert!((info.duration - 8.0).abs() < 0.3, "duration {}", info.duration);
    assert!(info.has_audio);
}

#[test]
fn exports_every_preset_with_correct_size_and_duration() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("out");
    let src = source(d.path(), &t);
    let before = std::fs::read(&src).unwrap();

    for (preset, w, h) in [
        (Preset::Original, 1280, 720),
        (Preset::Vertical, 1080, 1920),
        (Preset::Square, 1080, 1080),
        (Preset::Landscape, 1920, 1080),
    ] {
        let mut last = 0.0;
        let mut calls = 0;
        let res = export_clip(
            &t,
            &request(&src, &out, &format!("clip {}", preset.label()), 1.0, 4.0, preset),
            &AtomicBool::new(false),
            &mut |p| {
                assert!(p >= last - 1e-9, "progress must not go backwards");
                last = p;
                calls += 1;
            },
        )
        .unwrap();
        assert_eq!((res.width, res.height), (w, h), "{:?}", preset);
        assert!((res.duration - 3.0).abs() < 0.5, "duration {}", res.duration);
        assert!(std::path::Path::new(&res.output_path).is_file());
        assert!(res.size_bytes > 0);
        assert!(calls >= 1 && (last - 1.0).abs() < 1e-9, "progress must finish at 1.0");
        // The exported file must be independently readable.
        assert!(probe(&t, std::path::Path::new(&res.output_path)).is_ok());
    }
    assert_eq!(std::fs::read(&src).unwrap(), before, "source must be untouched");
}

#[test]
fn never_overwrites_existing_files() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("out");
    let src = source(d.path(), &t);
    let a = export_clip(&t, &request(&src, &out, "same", 0.0, 2.0, Preset::Original), &AtomicBool::new(false), &mut |_| {}).unwrap();
    let b = export_clip(&t, &request(&src, &out, "same", 0.0, 2.0, Preset::Original), &AtomicBool::new(false), &mut |_| {}).unwrap();
    assert_ne!(a.output_path, b.output_path);
    assert!(std::path::Path::new(&a.output_path).is_file() && std::path::Path::new(&b.output_path).is_file());
}

#[test]
fn exporting_into_the_source_folder_keeps_the_source() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let src = source(d.path(), &t);
    let before = std::fs::read(&src).unwrap();
    // A clip named "source" would collide with source.mp4 in the same folder.
    let res = export_clip(&t, &request(&src, d.path(), "source", 0.0, 2.0, Preset::Original), &AtomicBool::new(false), &mut |_| {}).unwrap();
    assert_ne!(std::path::Path::new(&res.output_path), src.as_path());
    assert_eq!(std::fs::read(&src).unwrap(), before);
}

#[test]
fn invalid_ranges_and_missing_media_fail_cleanly_without_leftovers() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("out");
    let src = source(d.path(), &t);

    let bad = export_clip(&t, &request(&src, &out, "bad", 6.0, 20.0, Preset::Original), &AtomicBool::new(false), &mut |_| {});
    assert!(matches!(bad, Err(CoreError::Invalid(_))));

    let missing = export_clip(&t, &request(&d.path().join("nope.mp4"), &out, "x", 0.0, 2.0, Preset::Original), &AtomicBool::new(false), &mut |_| {});
    assert!(matches!(missing, Err(CoreError::MissingMedia(_))));

    let leftovers = std::fs::read_dir(&out).map(|r| r.count()).unwrap_or(0);
    assert_eq!(leftovers, 0, "failed exports must not leave files behind");
}

#[test]
fn corrupt_input_is_reported_not_crashed() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let bogus = d.path().join("bogus.mp4");
    std::fs::write(&bogus, b"this is not a video").unwrap();
    assert!(probe(&t, &bogus).is_err());
}

#[test]
fn cancellation_stops_export_and_removes_partial_file() {
    let t = tools();
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("out");
    let src = source(d.path(), &t);
    let cancel = AtomicBool::new(true);
    let res = export_clip(&t, &request(&src, &out, "cancelled", 0.0, 6.0, Preset::Vertical), &cancel, &mut |_| {});
    assert!(matches!(res, Err(CoreError::Cancelled)));
    assert_eq!(std::fs::read_dir(&out).unwrap().count(), 0);
}
