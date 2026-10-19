/**
 * Browser media engine: single-threaded ffmpeg.wasm, bundled with the site.
 * Nothing is fetched from a third party and no video leaves the device.
 * Single-thread core => no SharedArrayBuffer / special headers needed (works on GitHub Pages).
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

export class EngineLoadError extends Error {}
export class CancelledError extends Error {}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let cancelled = false;

async function engine(): Promise<FFmpeg> {
  if (instance) return instance;
  if (!loading) {
    loading = (async () => {
      try {
        const ff = new FFmpeg();
        await ff.load({ coreURL, wasmURL });
        instance = ff;
        return ff;
      } catch (e) {
        throw new EngineLoadError(e instanceof Error ? e.message : "The video engine failed to start.");
      } finally {
        loading = null;
      }
    })();
  }
  return loading;
}

/** Run jobs one at a time: a single wasm instance can only do one thing at once. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

let mountId = 0;
async function withInput<T>(ff: FFmpeg, file: File, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = `/in${++mountId}`;
  await ff.createDir(dir);
  // WORKERFS reads the File lazily, so large videos are not copied into wasm memory.
  await ff.mount("WORKERFS" as never, { files: [file] }, dir);
  try {
    return await fn(`${dir}/${file.name}`);
  } finally {
    try { await ff.unmount(dir); } catch { /* ignore */ }
    try { await ff.deleteDir(dir); } catch { /* ignore */ }
  }
}

async function runCapturingLog(ff: FFmpeg, args: string[]): Promise<{ code: number; log: string }> {
  let log = "";
  const onLog = ({ message }: { message: string }) => { log += message + "\n"; };
  ff.on("log", onLog);
  try {
    const code = await ff.exec(args);
    return { code, log };
  } finally {
    ff.off("log", onLog);
  }
}

export function parseProbe(log: string): ProbeResult | null {
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const vid = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Video:\s*([\w]+)[^\n]*?,\s*(\d{2,5})x(\d{2,5})/.exec(log);
  if (!dur || !vid) return null;
  const fps = /(\d+(?:\.\d+)?)\s*fps/.exec(log);
  return {
    duration: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    width: Number(vid[2]),
    height: Number(vid[3]),
    fps: fps ? Number(fps[1]) : 30,
    hasAudio: /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*Audio:/.test(log),
    videoCodec: vid[1]
  };
}

function probeWith(ff: FFmpeg, file: File): Promise<ProbeResult> {
  return withInput(ff, file, async (path) => {
    const { log } = await runCapturingLog(ff, ["-hide_banner", "-i", path]);
    const info = parseProbe(log);
    if (!info) throw new Error("Could not read this file as a video. It may be damaged or not a video.");
    return info;
  });
}

export function probe(file: File): Promise<ProbeResult> {
  return serial(async () => probeWith(await engine(), file));
}

/** Small, fast H.264 copy so the browser can preview formats it cannot play itself (MKV, AVI, ...). */
export function makePreview(file: File, onProgress?: (fraction: number) => void): Promise<Blob> {
  return serial(async () => {
    const ff = await engine();
    cancelled = false;
    const onP = ({ progress }: { progress: number }) => onProgress?.(Math.max(0, Math.min(1, progress)));
    ff.on("progress", onP);
    try {
      return await withInput(ff, file, async (path) => {
        const code = await ff.exec([
          "-hide_banner", "-i", path, "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", "scale=-2:360,fps=15", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "64k", "-ac", "2", "-movflags", "+faststart", "-y", "preview.mp4"
        ]);
        if (code !== 0) throw new Error("Could not prepare a preview for this video.");
        const data = (await ff.readFile("preview.mp4")) as Uint8Array;
        await ff.deleteFile("preview.mp4").catch(() => undefined);
        return new Blob([data as unknown as BlobPart], { type: "video/mp4" });
      });
    } finally {
      ff.off("progress", onP);
    }
  });
}

export type Preset = "original" | "vertical" | "square" | "landscape";

export function cropFilter(preset: Preset, pan: number): string {
  const p = Math.max(0, Math.min(1, pan)).toFixed(4);
  if (preset === "original") return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const r = preset === "vertical" ? "9/16" : preset === "square" ? "1" : "16/9";
  // Largest r-shaped window that fits inside the frame, even dimensions, positioned by `pan`.
  const w = `trunc(min(iw\\,ih*${r})/2)*2`;
  const h = `trunc(min(ih\\,iw/(${r}))/2)*2`;
  return `crop=w=${w}:h=${h}:x=(iw-ow)*${p}:y=(ih-oh)*${p}`;
}

export interface WasmClip { id: string; name: string; start: number; end: number }
export interface WasmResult {
  clipId: string;
  ok: boolean;
  filename: string | null;
  blob: Blob | null;
  error: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
}

export function safeName(name: string): string {
  return name.replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-") || "clip";
}

export function exportClipsWasm(
  file: File,
  preset: Preset,
  pan: number,
  clips: WasmClip[],
  onProgress: (clipId: string, index: number, fraction: number) => void,
  verify: (blob: Blob) => Promise<{ duration: number; width: number; height: number }>
): Promise<WasmResult[]> {
  return serial(async () => {
    const ff = await engine();
    cancelled = false;
    const results: WasmResult[] = [];
    const used = new Set<string>();
    await withInput(ff, file, async (path) => {
      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        if (cancelled) { results.push(fail(clip.id, "Export cancelled.")); continue; }
        const onP = ({ progress }: { progress: number }) => onProgress(clip.id, i, Math.max(0, Math.min(0.99, progress)));
        ff.on("progress", onP);
        try {
          const dur = clip.end - clip.start;
          if (!(dur > 0)) throw new Error("This clip's end time must be after its start time.");
          let base = safeName(clip.name), n = 2;
          while (used.has(base)) base = `${safeName(clip.name)}-${n++}`;
          used.add(base);
          const out = `${base}.mp4`;
          const code = await ff.exec([
            "-hide_banner", "-ss", clip.start.toFixed(3), "-i", path, "-t", dur.toFixed(3),
            "-vf", `${cropFilter(preset, pan)},format=yuv420p`,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", out
          ]);
          if (cancelled) throw new Error("Export cancelled.");
          if (code !== 0) throw new Error("FFmpeg could not export this clip. The source may use an unsupported codec.");
          const data = (await ff.readFile(out)) as Uint8Array;
          await ff.deleteFile(out).catch(() => undefined);
          if (data.byteLength < 1024) throw new Error("The exported file is empty.");
          const blob = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
          // Prefer the browser's own player; fall back to FFmpeg if this browser can't decode H.264.
          const v = await verify(blob).catch(async () => {
            const p = await probeWith(ff, new File([blob], "verify.mp4"));
            return { duration: p.duration, width: p.width, height: p.height };
          });
          if (Math.abs(v.duration - dur) > Math.max(1, dur * 0.1)) throw new Error("The exported file has the wrong length.");
          onProgress(clip.id, i, 1);
          results.push({ clipId: clip.id, ok: true, filename: out, blob, error: null, duration: v.duration, width: v.width, height: v.height });
        } catch (e) {
          results.push(fail(clip.id, e instanceof Error ? e.message : "Export failed."));
        } finally {
          ff.off("progress", onP);
        }
      }
    });
    return results;
  });
}

function fail(clipId: string, error: string): WasmResult {
  return { clipId, ok: false, filename: null, blob: null, error, duration: null, width: null, height: null };
}

/** Stop the running job. The wasm instance is discarded and restarted on next use. */
export function cancelWasm(): void {
  cancelled = true;
  if (instance) { instance.terminate(); instance = null; }
}
