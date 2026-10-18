import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ClipOutcome, ExportProgress, Preset, Project, VideoInfo } from "./types";

/** True when running inside the desktop app (not a plain browser tab). */
export const isDesktop = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function message(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(message(e));
  }
}

export const api = {
  checkTools: () => call<{ ffmpeg: string; ffprobe: string }>("check_tools"),
  probeVideo: (path: string) => call<VideoInfo>("probe_video", { path }),
  loadProjects: () => call<Project[]>("load_projects"),
  saveProjects: (projects: Project[]) => call<void>("save_projects", { projects }),
  defaultOutputDir: () => call<string>("default_output_dir"),
  revealInFinder: (path: string) => call<void>("reveal_in_finder", { path }),
  cancelExport: () => call<void>("cancel_export"),
  exportClips: (job: {
    source: string;
    out_dir: string;
    preset: Preset;
    pan: number;
    clips: { id: string; name: string; start: number; end: number }[];
  }) => call<ClipOutcome[]>("export_clips", { job }),
  onExportProgress: (cb: (p: ExportProgress) => void): Promise<UnlistenFn> =>
    listen<ExportProgress>("export-progress", (e) => cb(e.payload))
};

const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"];

export async function pickVideo(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: "Choose a video to import",
    filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }]
  });
  return typeof picked === "string" ? picked : null;
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: true,
    title: "Choose where to save exported clips",
    defaultPath
  });
  return typeof picked === "string" ? picked : null;
}
