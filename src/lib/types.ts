export type Preset = "original" | "vertical" | "square" | "landscape";

export interface VideoInfo {
  path: string;
  file_name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  video_codec: string;
  size_bytes: number;
}

export interface Clip {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: VideoInfo | null;
  clips: Clip[];
  preset: Preset;
  /** 0..1 crop position for vertical/square/landscape presets. */
  pan: number;
  outputDir: string | null;
  lastExport: { at: string; files: number } | null;
}

export interface ClipOutcome {
  clip_id: string;
  ok: boolean;
  output_path: string | null;
  error: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
}

export interface ExportProgress {
  clip_id: string;
  index: number;
  total: number;
  fraction: number;
}

export type ProjectStatus = "No video" | "Ready" | "Exported" | "Source missing";
