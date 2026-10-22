import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ClipOutcome, ExportProgress, Preset, Project, VideoInfo } from "./types";
import type { BurnCaptions, BurnEffects } from "./wasm";
import type { CaptionLine } from "./captions";
import { EngineLoadError, cancelWasm, exportClipsWasm, makePreview, probe } from "./wasm";

export const isDesktop = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function message(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(cmd, args); } catch (e) { throw new Error(message(e)); }
}

const DB_NAME = "clipforge-local";
const STORE = "videos";
const browserFiles = new Map<string, File>();
const objectUrls = new Map<string, string>();
let progressListeners: ((p: ExportProgress) => void)[] = [];
let prepareListeners: ((msg: string | null) => void)[] = [];
const say = (msg: string | null) => prepareListeners.forEach((cb) => cb(msg));
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function storeFile(key: string, file: File) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getBlob(key: string): Promise<Blob | null> {
  const d = await db();
  return await new Promise<Blob | null>((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}
async function storeBlob(key: string, blob: Blob) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getFile(key: string): Promise<File> {
  if (browserFiles.has(key)) return browserFiles.get(key)!;
  const d = await db();
  return await new Promise<File>((resolve, reject) => {
    const req = d.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => req.result ? resolve(req.result as File) : reject(new Error("Video file is no longer available. Please import it again."));
    req.onerror = () => reject(req.error);
  });
}
export async function videoSrc(path: string): Promise<string> {
  if (isDesktop()) return (await import("@tauri-apps/api/core")).convertFileSrc(path);
  if (objectUrls.has(path)) return objectUrls.get(path)!;
  if (previewStates.get(path)?.status === "pending") throw new Error("preview-pending");
  const preview = await getBlob(`${path}:preview`).catch(() => null);
  const url = URL.createObjectURL(preview ?? (await getFile(path)));
  objectUrls.set(path, url);
  return url;
}
function browserPickVideo(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "video/*,.mkv,.avi,.mov,.m4v,.webm,.mp4";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const key = `video:${crypto.randomUUID()}`;
      // Keep the File in memory and return immediately. Copying a multi-GB video into
      // IndexedDB can take a long time, so persist it in the background (only needed after a reload).
      browserFiles.set(key, file);
      storeFile(key, file).catch(() => undefined);
      resolve(key);
    };
    input.click();
  });
}
function nativeMetadata(file: File): Promise<{ duration: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (v: { duration: number; width: number; height: number } | null) => { clearTimeout(t); URL.revokeObjectURL(url); video.removeAttribute("src"); resolve(v); };
    const t = setTimeout(() => done(null), 6000);
    video.preload = "metadata"; video.muted = true;
    video.onloadedmetadata = () => done(video.videoWidth > 0 && isFinite(video.duration) ? { duration: video.duration, width: video.videoWidth, height: video.videoHeight } : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}
export type PreviewState = { status: "pending"; fraction: number } | { status: "ready" } | { status: "failed"; error: string };
const previewStates = new Map<string, PreviewState>();
const previewSubs = new Map<string, Set<(s: PreviewState) => void>>();
const infoCache = new Map<string, VideoInfo>();
export const getPreviewState = (path: string) => previewStates.get(path);
export function onPreviewState(path: string, cb: (s: PreviewState) => void): () => void {
  if (!previewSubs.has(path)) previewSubs.set(path, new Set());
  previewSubs.get(path)!.add(cb);
  return () => { previewSubs.get(path)?.delete(cb); };
}
function setPreviewState(path: string, st: PreviewState) {
  previewStates.set(path, st);
  previewSubs.get(path)?.forEach((cb) => cb(st));
}
/** Build the small preview copy in the background; the editor is usable (time fields, export) meanwhile. */
const MAX_AUTO_PREVIEW_SECONDS = 15 * 60;
async function ensurePreview(file: File, path: string, duration: number) {
  if (previewStates.get(path)?.status === "pending" || previewStates.get(path)?.status === "ready") return;
  if (await getBlob(`${path}:preview`).catch(() => null)) { setPreviewState(path, { status: "ready" }); return; }
  if (duration > MAX_AUTO_PREVIEW_SECONDS) {
    // Building a preview of a long video would keep the single video engine busy for minutes and block exports.
    setPreviewState(path, { status: "failed", error: "Preview skipped for long videos." });
    return;
  }
  setPreviewState(path, { status: "pending", fraction: 0 });
  try {
    const preview = await makePreview(file, (f) => setPreviewState(path, { status: "pending", fraction: f }));
    await storeBlob(`${path}:preview`, preview).catch(() => undefined);
    // videoSrc() prefers a stored preview; keep an in-memory URL too in case storage is unavailable.
    objectUrls.set(path, URL.createObjectURL(preview));
    setPreviewState(path, { status: "ready" });
  } catch (e) {
    setPreviewState(path, { status: "failed", error: e instanceof Error ? e.message : "Could not prepare a preview." });
  }
}
async function metadata(file: File, path: string): Promise<VideoInfo> {
  const cached = infoCache.get(path);
  if (cached) return cached;
  const native = await nativeMetadata(file);
  if (native) {
    const info: VideoInfo = { path, file_name: file.name, duration: native.duration, width: native.width, height: native.height, fps: 30, has_audio: true, video_codec: "browser-decoded", size_bytes: file.size };
    infoCache.set(path, info);
    return info;
  }
  // The browser can't play this format (e.g. MKV/AVI): read it with ffmpeg (fast) and
  // build the preview copy in the background instead of making the user wait for it.
  try {
    say("Reading the video…");
    const p = await probe(file);
    const info: VideoInfo = { path, file_name: file.name, duration: p.duration, width: p.width, height: p.height, fps: p.fps, has_audio: p.hasAudio, video_codec: p.videoCodec, size_bytes: file.size };
    infoCache.set(path, info);
    void ensurePreview(file, path, p.duration);
    return info;
  } catch (e) {
    if (e instanceof EngineLoadError) throw new Error("This format can't be read by your browser and the built-in video engine could not start. Try Chrome or Edge, or convert the file to MP4.");
    throw e;
  } finally {
    say(null);
  }
}
function verifyBlob(blob: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    const finish = (fn: () => void) => { URL.revokeObjectURL(url); fn(); };
    const t = setTimeout(() => finish(() => reject(new Error("The exported file could not be opened to verify it."))), 15000);
    v.preload = "metadata"; v.muted = true;
    v.onloadedmetadata = () => { clearTimeout(t); finish(() => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })); };
    v.onerror = () => { clearTimeout(t); finish(() => reject(new Error("The exported file could not be opened to verify it."))); };
    v.src = url;
  });
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function wasmBrowserExport(job: {source:string;out_dir:string;preset:Preset;pan:number;clips:{id:string;name:string;start:number;end:number}[];captions?:BurnCaptions;effects?:BurnEffects}): Promise<ClipOutcome[]> {
  const file = await getFile(job.source);
  const results = await exportClipsWasm(
    file, job.preset, job.pan, job.clips,
    (clip_id, index, fraction) => progressListeners.forEach((cb) => cb({ clip_id, index, total: job.clips.length, fraction })),
    verifyBlob,
    job.captions,
    job.effects
  );
  return results.map((r) => {
    if (r.ok && r.blob && r.filename) download(r.blob, r.filename);
    return { clip_id: r.clipId, ok: r.ok, output_path: r.filename, error: r.error, duration: r.duration, width: r.width, height: r.height, size_bytes: r.blob?.size ?? null };
  });
}
async function browserExport(job: {source:string;out_dir:string;preset:Preset;pan:number;clips:{id:string;name:string;start:number;end:number}[]}): Promise<ClipOutcome[]> {
  const file = await getFile(job.source);
  const sourceUrl = URL.createObjectURL(file);
  const outcomes: ClipOutcome[] = [];
  const video = document.createElement("video");
  video.src = sourceUrl; video.muted = false; video.playsInline = true;
  await new Promise<void>((resolve, reject) => { video.onloadedmetadata=()=>resolve(); video.onerror=()=>reject(new Error("Could not decode this video in the browser.")); });
  for (let index=0; index<job.clips.length; index++) {
    const clip=job.clips[index];
    try {
      const ratio = job.preset === "vertical" ? 9/16 : job.preset === "square" ? 1 : job.preset === "landscape" ? 16/9 : video.videoWidth/video.videoHeight;
      const width = job.preset === "original" ? video.videoWidth : ratio === 1 ? Math.min(video.videoWidth,video.videoHeight) : ratio > 1 ? Math.min(video.videoWidth,Math.round(video.videoHeight*ratio)) : Math.min(video.videoWidth,Math.round(video.videoHeight*ratio));
      const height = Math.round(width/ratio);
      const canvas=document.createElement("canvas"); canvas.width=Math.max(2,width); canvas.height=Math.max(2,height);
      const ctx=canvas.getContext("2d"); if(!ctx) throw new Error("Canvas video processing is unavailable.");
      const stream=canvas.captureStream(30);
      try { const audio=(video as HTMLVideoElement & {captureStream?:()=>MediaStream}).captureStream?.(); audio?.getAudioTracks().forEach(t=>stream.addTrack(t)); } catch {}
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
      if(!MediaRecorder.isTypeSupported(mime)) throw new Error("This browser does not support WebM export. Use a recent version of Chrome or Edge.");
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:6000000});
      const chunks: BlobPart[]=[];
      const stopped=new Promise<Blob>((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onerror=()=>reject(new Error("Browser recording failed."));recorder.onstop=()=>resolve(new Blob(chunks,{type:mime}));});
      video.currentTime=clip.start; await new Promise<void>(r=>{video.onseeked=()=>r()});
      const draw=()=>{if(video.paused && !recorder || video.ended)return; const sw=video.videoWidth,sh=video.videoHeight; const cropW=Math.min(sw,sh*ratio),cropH=cropW/ratio; const sx=(sw-cropW)*job.pan; const sy=(sw-cropW < 1 ? (sh-cropH)*job.pan : (sh-cropH)*job.pan); ctx.drawImage(video,sx,sy,cropW,cropH,0,0,canvas.width,canvas.height);};
      let raf=0; const frame=()=>{draw(); if(video.currentTime < clip.end && !video.paused) raf=requestAnimationFrame(frame); else if(recorder.state==="recording") recorder.stop();};
      recorder.start(250); await video.play(); raf=requestAnimationFrame(frame);
      const timer=setTimeout(()=>{if(recorder.state==="recording")recorder.stop();video.pause();cancelAnimationFrame(raf)},Math.max(500,(clip.end-clip.start)*1000+500));
      const blob=await stopped; clearTimeout(timer); video.pause(); cancelAnimationFrame(raf);
      const safe=clip.name.replace(/[^a-z0-9-_ ]/gi,"").trim().replace(/\s+/g,"-")||"clip";
      const filename=`${safe}.webm`; const url=URL.createObjectURL(blob); const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      outcomes.push({clip_id:clip.id,ok:true,output_path:filename,error:null,duration:clip.end-clip.start,width:canvas.width,height:canvas.height,size_bytes:blob.size});
      progressListeners.forEach(cb=>cb({clip_id:clip.id,index,total:job.clips.length,fraction:1}));
    } catch(e) { outcomes.push({clip_id:clip.id,ok:false,output_path:null,error:message(e),duration:null,width:null,height:null,size_bytes:null}); }
  }
  URL.revokeObjectURL(sourceUrl);
  return outcomes;
}

/** Transcode only the requested time range for a responsive preview of long or browser-incompatible videos. */
export async function prepareSegmentPreview(path: string, start: number, end: number, onProgress?: (fraction: number) => void): Promise<string> {
  if (isDesktop()) throw new Error("Segment previews are only needed in the browser version.");
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.5) throw new Error("Choose a valid preview segment at least half a second long.");
  const file = await getFile(path);
  const blob = await makePreview(file, onProgress, { start, end });
  return URL.createObjectURL(blob);
}

export type TranscribeOptions = { language: string; model: "tiny" | "base" | "small" };
export type TranscribeStatus = { stage: "audio" | "model" | "listening"; fraction: number | null; note?: string };
/** Speech-to-text on this device (Whisper). The model files download once from huggingface.co and are cached by the browser. */
export async function transcribeVideo(path: string, start: number, end: number, opts: TranscribeOptions, onStatus: (s: TranscribeStatus) => void): Promise<CaptionLine[]> {
  if (isDesktop()) throw new Error("Speech-to-text is only available in the website version for now.");
  const file = await getFile(path);
  const { transcribeFile } = await import("./transcribe");
  return transcribeFile(file, start, end, opts, onStatus);
}

export function onPrepareStatus(cb: (msg: string | null) => void): () => void {
  prepareListeners.push(cb);
  return () => { prepareListeners = prepareListeners.filter((x) => x !== cb); };
}

export const api = {
  transcribeVideo,
  checkTools: () => isDesktop() ? call<{ffmpeg:string;ffprobe:string}>("check_tools") : Promise.resolve({ffmpeg:"ffmpeg.wasm (in your browser)",ffprobe:"ffmpeg.wasm (in your browser)"}),
  probeVideo: async (path:string) => isDesktop() ? call<VideoInfo>("probe_video",{path}) : metadata(await getFile(path),path),
  loadProjects: () => isDesktop() ? call<Project[]>("load_projects") : Promise.resolve(JSON.parse(localStorage.getItem("clipforge.projects") || "[]") as Project[]),
  saveProjects: (projects:Project[]) => isDesktop() ? call<void>("save_projects",{projects}) : Promise.resolve().then(()=>localStorage.setItem("clipforge.projects",JSON.stringify(projects))),
  defaultOutputDir: () => isDesktop() ? call<string>("default_output_dir") : Promise.resolve("Downloads (browser-managed)"),
  revealInFinder: (path:string) => isDesktop() ? call<void>("reveal_in_finder",{path}) : Promise.resolve(),
  cancelExport: () => isDesktop() ? call<void>("cancel_export") : Promise.resolve(cancelWasm()),
  exportClips: (job:{source:string;out_dir:string;preset:Preset;pan:number;clips:{id:string;name:string;start:number;end:number}[];captions?:BurnCaptions;effects?:BurnEffects}) => isDesktop() ? call<ClipOutcome[]>("export_clips",{job}) : wasmBrowserExport(job).catch((e) => { if (e instanceof EngineLoadError) return browserExport(job); throw e; }),
  onExportProgress: (cb:(p:ExportProgress)=>void):Promise<UnlistenFn> => isDesktop() ? listen<ExportProgress>("export-progress",e=>cb(e.payload)) : Promise.resolve((()=>{progressListeners.push(cb);return()=>{progressListeners=progressListeners.filter(x=>x!==cb)}})())
};
const VIDEO_EXTENSIONS=["mp4","mov","m4v","mkv","webm","avi"];
export async function pickVideo():Promise<string|null>{
 if(!isDesktop()) return browserPickVideo();
 const picked=await open({multiple:false,directory:false,title:"Choose a video to import",filters:[{name:"Video",extensions:VIDEO_EXTENSIONS}]});
 return typeof picked==="string"?picked:null;
}
export async function pickFolder(defaultPath?:string):Promise<string|null>{
 if(!isDesktop()) return null;
 const picked=await open({multiple:false,directory:true,title:"Choose where to save exported clips",defaultPath});
 return typeof picked==="string"?picked:null;
}
