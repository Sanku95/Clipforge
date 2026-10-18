mod selftest;

use clipforge_core::{
    export_clip, load_json, probe, save_json, ClipSpec, CoreError, ExportRequest, Preset, Tools,
    VideoInfo,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct AppState {
    cancel: Arc<AtomicBool>,
    exporting: AtomicBool,
}

fn err(e: CoreError) -> String {
    e.to_string()
}

fn tools() -> Result<Tools, String> {
    Tools::locate().map_err(err)
}

/// Let the webview play this one file through the asset protocol. The scope is
/// empty by default, so only files the user picked are ever readable.
fn allow_media(app: &AppHandle, path: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(path)
        .map_err(|e| format!("could not enable preview: {e}"))
}

#[derive(Serialize)]
struct ToolStatus {
    ffmpeg: String,
    ffprobe: String,
}

#[tauri::command]
fn check_tools() -> Result<ToolStatus, String> {
    let t = tools()?;
    Ok(ToolStatus { ffmpeg: t.ffmpeg.display().to_string(), ffprobe: t.ffprobe.display().to_string() })
}

#[tauri::command]
fn probe_video(app: AppHandle, path: String) -> Result<VideoInfo, String> {
    let p = PathBuf::from(&path);
    let info = probe(&tools()?, &p).map_err(err)?;
    allow_media(&app, &p)?;
    Ok(info)
}

fn projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("projects.json"))
}

#[tauri::command]
fn load_projects(app: AppHandle) -> Result<serde_json::Value, String> {
    load_json(&projects_file(&app)?).map_err(err)
}

#[tauri::command]
fn save_projects(app: AppHandle, projects: serde_json::Value) -> Result<(), String> {
    if !projects.is_array() {
        return Err("projects must be a list".into());
    }
    save_json(&projects_file(&app)?, &projects).map_err(err)
}

#[tauri::command]
fn default_output_dir(app: AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .video_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    Ok(base.join("ClipForge").display().to_string())
}

#[derive(Deserialize)]
struct ClipInput {
    id: String,
    name: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct ExportJob {
    source: String,
    out_dir: String,
    preset: Preset,
    pan: f64,
    clips: Vec<ClipInput>,
}

#[derive(Serialize, Clone)]
struct Progress {
    clip_id: String,
    index: usize,
    total: usize,
    fraction: f64,
}

#[derive(Serialize)]
struct ClipOutcome {
    clip_id: String,
    ok: bool,
    output_path: Option<String>,
    error: Option<String>,
    duration: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    size_bytes: Option<u64>,
}

#[tauri::command]
async fn export_clips(app: AppHandle, state: State<'_, AppState>, job: ExportJob) -> Result<Vec<ClipOutcome>, String> {
    if job.clips.is_empty() {
        return Err("There are no clips to export.".into());
    }
    if state.exporting.swap(true, Ordering::SeqCst) {
        return Err("An export is already running.".into());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let cancel = state.cancel.clone();
    let tools = match tools() {
        Ok(t) => t,
        Err(e) => {
            state.exporting.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let total = job.clips.len();
        let mut outcomes = Vec::with_capacity(total);
        for (index, clip) in job.clips.iter().enumerate() {
            if cancel.load(Ordering::Relaxed) {
                outcomes.push(ClipOutcome {
                    clip_id: clip.id.clone(),
                    ok: false,
                    output_path: None,
                    error: Some(CoreError::Cancelled.to_string()),
                    duration: None,
                    width: None,
                    height: None,
                    size_bytes: None,
                });
                continue;
            }
            let req = ExportRequest {
                input: PathBuf::from(&job.source),
                out_dir: PathBuf::from(&job.out_dir),
                clip: ClipSpec { name: clip.name.clone(), start: clip.start, end: clip.end },
                preset: job.preset,
                pan: job.pan,
            };
            let clip_id = clip.id.clone();
            let h = handle.clone();
            let mut emit = |fraction: f64| {
                let _ = h.emit("export-progress", Progress { clip_id: clip_id.clone(), index, total, fraction });
            };
            emit(0.0);
            outcomes.push(match export_clip(&tools, &req, &cancel, &mut emit) {
                Ok(r) => ClipOutcome {
                    clip_id: clip.id.clone(),
                    ok: true,
                    output_path: Some(r.output_path),
                    error: None,
                    duration: Some(r.duration),
                    width: Some(r.width),
                    height: Some(r.height),
                    size_bytes: Some(r.size_bytes),
                },
                Err(e) => ClipOutcome {
                    clip_id: clip.id.clone(),
                    ok: false,
                    output_path: None,
                    error: Some(e.to_string()),
                    duration: None,
                    width: None,
                    height: None,
                    size_bytes: None,
                },
            });
        }
        outcomes
    })
    .await
    .map_err(|e| format!("export task failed: {e}"));

    state.exporting.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn cancel_export(state: State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("That file no longer exists.".into());
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg("-R").arg(&p).status();
    #[cfg(not(target_os = "macos"))]
    let status = std::process::Command::new("xdg-open")
        .arg(p.parent().unwrap_or(Path::new(".")))
        .status();
    status.map(|_| ()).map_err(|e| e.to_string())
}

pub fn run() {
    if std::env::args().any(|a| a == "--selftest") {
        std::process::exit(selftest::run());
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            check_tools,
            probe_video,
            load_projects,
            save_projects,
            default_output_dir,
            export_clips,
            cancel_export,
            reveal_in_finder
        ])
        .run(tauri::generate_context!())
        .expect("error while running ClipForge");
}
