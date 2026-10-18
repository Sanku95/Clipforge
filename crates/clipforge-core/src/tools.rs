use crate::{CoreError, Result};
use std::path::{Path, PathBuf};

/// Locations of the FFmpeg and FFprobe executables.
#[derive(Debug, Clone)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

impl Tools {
    /// Find the tools. Search order:
    /// 1. `CLIPFORGE_FFMPEG` / `CLIPFORGE_FFPROBE` environment variables
    /// 2. next to the running executable (where the bundled app keeps them)
    /// 3. the `PATH`, plus common Homebrew locations (development only)
    pub fn locate() -> Result<Tools> {
        Ok(Tools {
            ffmpeg: locate_one("ffmpeg", "CLIPFORGE_FFMPEG")?,
            ffprobe: locate_one("ffprobe", "CLIPFORGE_FFPROBE")?,
        })
    }
}

fn locate_one(name: &str, env_var: &str) -> Result<PathBuf> {
    if let Some(v) = std::env::var_os(env_var) {
        let p = PathBuf::from(v);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(name);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let p = dir.join(name);
            if p.is_file() {
                return Ok(p);
            }
        }
    }
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let p = Path::new(dir).join(name);
        if p.is_file() {
            return Ok(p);
        }
    }
    Err(CoreError::ToolMissing(name.to_string()))
}
