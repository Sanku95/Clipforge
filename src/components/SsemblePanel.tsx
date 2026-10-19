import { useEffect, useRef, useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { Button, Panel } from "./ui";

type Short = { title?: string; video_url?: string; videoUrl?: string; url?: string; duration?: number; score?: number };
type JobState = { status: string; progress?: number | null; message?: string | null; result?: { shorts?: Short[]; clips?: Short[]; title?: string } };
const apiError = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  return body?.error ?? "Something went wrong. Please try again.";
};

export function SsemblePanel() {
  const [rangeEnd, setRangeEnd] = useState("600");
  const [maxShorts, setMaxShorts] = useState("3");
  const [language, setLanguage] = useState("en");
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => { if (pollRef.current !== null) window.clearTimeout(pollRef.current); }, []);

  const checkStatus = async (id: string) => {
    try {
      const response = await fetch(`/api/ssemble/status?id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error(await apiError(response));
      const data = await response.json() as JobState;
      setJob(data);
      if (data.status === "completed" || data.status === "failed") {
        setBusy(false);
        return;
      }
      pollRef.current = window.setTimeout(() => void checkStatus(id), 10000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check processing status.");
      setBusy(false);
    }
  };

  const generate = async () => {
    setError("");
    setJob(null);
    if (window.location.hostname.endsWith("github.io")) {
      setError("AI clipping is not available on the GitHub Pages preview because it cannot run the Ssemble backend. Open the ClipForge Vercel deployment after it is configured with your Ssemble API key.");
      return;
    }
    setBusy(true);
    const end = Number(rangeEnd);
    if (!Number.isFinite(end) || end < 60 || end > 1200) {
      setError("Choose an analysis range between 60 and 1,200 seconds (1–20 minutes).");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/ssemble/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, start: 0, end, maxShorts: Number(maxShorts), language })
      });
      if (!response.ok) throw new Error(await apiError(response));
      const data = await response.json();
      const id = data?.data?.requestId;
      if (typeof id !== "string") throw new Error("Ssemble did not return a request ID.");
      setJobId(id);
      setJob({ status: "processing", progress: 0 });
      void checkStatus(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start AI clipping.");
      setBusy(false);
    }
  };

  const shorts = job?.result?.shorts ?? job?.result?.clips ?? [];
  return (
    <Panel className="space-y-4 p-5">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-ember" aria-hidden />
        <div>
          <h2 className="text-base font-semibold">Generate AI clips with Ssemble</h2>
          <p className="mt-1 text-sm text-mute">Ssemble processes the video on its service and returns short clips with AI-selected moments and captions. This is separate from ClipForge's local editor.</p>
        </div>
      </div>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Standard YouTube video URL</span>
        <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} type="url" placeholder="https://www.youtube.com/watch?v=..." className="w-full rounded-lg border border-line bg-panel px-3 py-2.5 text-sm outline-none focus:border-ember" />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Analyze first (seconds)</span>
          <select value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} className="w-full rounded-lg border border-line bg-panel px-3 py-2.5">
            <option value="180">3 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1200">20 minutes</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Maximum clips</span>
          <select value={maxShorts} onChange={(e) => setMaxShorts(e.target.value)} className="w-full rounded-lg border border-line bg-panel px-3 py-2.5">
            <option value="1">1 clip</option><option value="3">3 clips</option><option value="5">5 clips</option><option value="8">8 clips</option><option value="12">12 clips</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Spoken language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full rounded-lg border border-line bg-panel px-3 py-2.5">
            <option value="en">English</option><option value="hi">Hindi</option><option value="mr">Marathi</option><option value="es">Spanish</option><option value="pt">Portuguese</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-mute">Each generation request uses one Ssemble credit. Processing usually takes 5–30 minutes. YouTube Shorts links are not supported by their API; use a standard video URL.</p>
      {error && <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
      <Button variant="primary" onClick={() => void generate()} busy={busy} disabled={!sourceUrl.trim() || busy}><Sparkles className="h-4 w-4" /> Generate AI clips</Button>
      {job && (
        <div role="status" aria-live="polite" className="space-y-3 rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{job.status === "completed" ? "Your clips are ready" : job.status === "failed" ? "Generation failed" : "AI is processing your video…"}</span>
            {job.progress != null && <span className="text-xs text-mute">{job.progress}%</span>}
          </div>
          {busy && <div className="h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-ember transition-all" style={{ width: `${Math.max(5, Math.min(100, job.progress ?? 5))}%` }} /></div>}
          {job.message && <p className="text-sm text-mute">{job.message}</p>}
          {job.status === "failed" && <p className="text-sm text-red-300">Ssemble reported a processing failure. Try a shorter analysis range.</p>}
          {shorts.length > 0 && <ul className="space-y-2">{shorts.map((short, index) => {
            const videoUrl = short.video_url ?? short.videoUrl ?? short.url;
            return <li key={videoUrl ?? index} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{short.title ?? `AI clip ${index + 1}`}</p>{short.duration != null && <p className="text-xs text-mute">{Math.round(short.duration)} seconds</p>}</div>
              {videoUrl && <a href={videoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm hover:border-ember"><Download className="h-4 w-4" /> Open / download</a>}
            </li>;
          })}</ul>}
          {job.status === "completed" && shorts.length === 0 && <p className="text-sm text-mute">Ssemble finished, but no clip URLs were found in the response. Request ID: {jobId}</p>}
        </div>
      )}
    </Panel>
  );
}
