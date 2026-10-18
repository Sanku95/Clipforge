import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { ClipOutcome, ExportProgress, Preset, Project, VideoInfo } from "./types";

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
  const url = URL.createObjectURL(await getFile(path));
  objectUrls.set(path, url);
  return url;
}
function browserPickVideo(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "video/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const key = `video:${crypto.randomUUID()}`;
      try {
        await storeFile(key, file); browserFiles.set(key, file);
        resolve(key);
      } catch { resolve(null); }
    };
    input.click();
  });
}
function metadata(file: File, path: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata"; video.src = url;
    video.onloadedmetadata = () => {
      const info: VideoInfo = { path, file_name: file.name, duration: video.duration, width: video.videoWidth, height: video.videoHeight, fps: 30, has_audio: true, video_codec: "browser-decoded", size_bytes: file.size };
      URL.revokeObjectURL(url); resolve(info);
    };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This video format cannot be read by your browser. Try MP4 (H.264).")); };
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
      const width = job.preset === "original" ? video.videoWidth : ratio === 1 ? Math.min(video.videoWidth,video.videoHeight) : ratio > 1 ? Math.min(video.videoWidth,Math.round(video.videoHeight*ratio)) : Math.min(video.videoHeight,Math.round(video.videoWidth/ratio));
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
      const draw=()=>{if(video.paused && !recorder || video.ended)return; const sw=video.videoWidth,sh=video.videoHeight; const cropW=Math.min(sw,sh*ratio),cropH=cropW/ratio; const sx=(sw-cropW)*job.pan; const sy=(sh-cropH)*0.5; ctx.drawImage(video,sx,sy,cropW,cropH,0,0,canvas.width,canvas.height);};
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

export const api = {
  checkTools: () => isDesktop() ? call<{ffmpeg:string;ffprobe:string}>("check_tools") : Promise.resolve({ffmpeg:"Browser MediaRecorder",ffprobe:"HTML video decoder"}),
  probeVideo: async (path:string) => isDesktop() ? call<VideoInfo>("probe_video",{path}) : metadata(await getFile(path),path),
  loadProjects: () => isDesktop() ? call<Project[]>("load_projects") : Promise.resolve(JSON.parse(localStorage.getItem("clipforge.projects") || "[]") as Project[]),
  saveProjects: (projects:Project[]) => isDesktop() ? call<void>("save_projects",{projects}) : Promise.resolve().then(()=>localStorage.setItem("clipforge.projects",JSON.stringify(projects))),
  defaultOutputDir: () => isDesktop() ? call<string>("default_output_dir") : Promise.resolve("Downloads (browser-managed)"),
  revealInFinder: (path:string) => isDesktop() ? call<void>("reveal_in_finder",{path}) : Promise.resolve(),
  cancelExport: () => isDesktop() ? call<void>("cancel_export") : Promise.resolve(),
  exportClips: (job:{source:string;out_dir:string;preset:Preset;pan:number;clips:{id:string;name:string;start:number;end:number}[]}) => isDesktop() ? call<ClipOutcome[]>("export_clips",{job}) : browserExport(job),
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
