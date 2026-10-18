//! ClipForge media core.
//!
//! Everything here is real processing done by FFmpeg/FFprobe: no simulated
//! progress. The crate has no GUI dependencies so it can be tested headlessly.

mod export;
mod geometry;
mod probe;
mod store;
mod tools;

pub use export::{
    available_space, export_clip, generate_test_video, sanitize_file_name, validate_clip,
    ClipSpec, ExportRequest, ExportResult,
};
pub use geometry::{crop_rect, even_floor, CropRect, Preset};
pub use probe::{parse_probe, probe, VideoInfo};
pub use store::{load_json, save_json};
pub use tools::Tools;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("{0}")]
    Invalid(String),
    #[error("Could not find {0}. Reinstall ClipForge, or set the CLIPFORGE_FFMPEG / CLIPFORGE_FFPROBE environment variables.")]
    ToolMissing(String),
    #[error("The source video could not be found: {0}")]
    MissingMedia(String),
    #[error("Not enough free disk space in the output folder (need about {needed_mb} MB, have {available_mb} MB).")]
    DiskSpace { needed_mb: u64, available_mb: u64 },
    #[error("FFmpeg could not process this video: {0}")]
    Ffmpeg(String),
    #[error("The exported file failed verification: {0}")]
    Verify(String),
    #[error("Export cancelled.")]
    Cancelled,
    #[error("File system error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, CoreError>;
