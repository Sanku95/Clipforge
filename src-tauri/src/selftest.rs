//! `ClipForge --selftest`: exercises the bundled FFmpeg end to end without a
//! window. CI runs this against the *installed* app inside the built DMG.

use clipforge_core::*;
use std::sync::atomic::AtomicBool;

pub fn run() -> i32 {
    match run_inner() {
        Ok(lines) => {
            for l in lines {
                println!("{l}");
            }
            println!("SELFTEST PASSED");
            0
        }
        Err(e) => {
            eprintln!("SELFTEST FAILED: {e}");
            1
        }
    }
}

fn run_inner() -> Result<Vec<String>> {
    let tools = Tools::locate()?;
    let mut log = vec![
        format!("ffmpeg  : {}", tools.ffmpeg.display()),
        format!("ffprobe : {}", tools.ffprobe.display()),
    ];
    let dir = std::env::temp_dir().join(format!("clipforge-selftest-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let src = dir.join("source.mp4");
    generate_test_video(&tools, &src, 6, 1280, 720)?;
    let info = probe(&tools, &src)?;
    log.push(format!("source  : {}x{} {:.1}s", info.width, info.height, info.duration));

    for (preset, w, h) in [
        (Preset::Original, 1280, 720),
        (Preset::Vertical, 1080, 1920),
        (Preset::Square, 1080, 1080),
        (Preset::Landscape, 1920, 1080),
    ] {
        let res = export_clip(
            &tools,
            &ExportRequest {
                input: src.clone(),
                out_dir: dir.join("out"),
                clip: ClipSpec { name: format!("selftest {}", preset.label()), start: 1.0, end: 4.0 },
                preset,
                pan: 0.5,
            },
            &AtomicBool::new(false),
            &mut |_| {},
        )?;
        if (res.width, res.height) != (w, h) {
            return Err(CoreError::Verify(format!("{:?}: got {}x{}", preset, res.width, res.height)));
        }
        log.push(format!("export  : {:<9} -> {}x{} {:.1}s {} bytes", preset.label(), res.width, res.height, res.duration, res.size_bytes));
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(log)
}
