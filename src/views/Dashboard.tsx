import { useEffect, useState } from "react";
import { Clapperboard, FilePlus2, Scissors, Sparkles } from "lucide-react";
import { projectStatus, useProjects } from "../lib/projects";
import { useImport } from "../lib/useImport";
import { formatDuration } from "../lib/time";
import { Badge, Button, EmptyState, ErrorBanner, Panel, Spinner, Stat } from "../components/ui";
import type { Route } from "../components/Sidebar";

interface Props {
  onOpen: (id: string) => void;
  onNavigate: (r: Route) => void;
}

export function Dashboard({ onOpen, onNavigate }: Props) {
  const { projects, loading, loadError, saveError } = useProjects();
  const { importVideo, busy, error, clearError } = useImport();
  const [elapsed, setElapsed] = useState(0);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeId, setYoutubeId] = useState<string | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const timer = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const start = async () => {
    const p = await importVideo();
    if (p) onOpen(p.id);
  };

  const loadYoutubeLink = () => {
    setYoutubeError(null);
    setYoutubeId(null);
    try {
      const url = new URL(youtubeUrl.trim());
      let host = url.hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);
      let id: string | null = null;
      if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? null;
      if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
        if (url.pathname === "/watch") id = url.searchParams.get("v");
        else if (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/")) id = url.pathname.split("/")[2] ?? null;
      }
      if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        setYoutubeError("Enter a valid YouTube video link.");
        return;
      }
      setYoutubeId(id);
    } catch {
      setYoutubeError("Paste a full YouTube link, such as https://www.youtube.com/watch?v=...");
    }
  };

  const clipCount = projects.reduce((n, p) => n + p.clips.length, 0);
  const exported = projects.filter((p) => p.lastExport).length;
  const recent = projects.slice(0, 5);
  const elapsedLabel = elapsed < 60 ? `${elapsed}s elapsed` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`;

  return (
    <>
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Turn long videos into short clips</h1>
            <p className="mt-1 text-sm text-mute">Import a video, mark your best moments, and export for Shorts, Reels or TikTok.</p>
          </div>
          <Button variant="primary" onClick={start} busy={busy} className="shrink-0 px-4 py-2.5">
            <FilePlus2 className="h-4 w-4" /> Import video
          </Button>
        </div>

        {error && <ErrorBanner onDismiss={clearError}>{error}</ErrorBanner>}
        {loadError && <ErrorBanner>Could not load your projects: {loadError}</ErrorBanner>}
        {saveError && <ErrorBanner>Could not save your projects: {saveError}</ErrorBanner>}

        <Panel className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Start from a YouTube link</h2>
            <p className="mt-1 text-sm text-mute">Preview a video here, then use a video file you own or have permission to edit to create clips.</p>
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); loadYoutubeLink(); }}>
            <input
              type="url"
              value={youtubeUrl}
              onChange={(event) => setYoutubeUrl(event.target.value)}
              placeholder="Paste YouTube video URL"
              aria-label="YouTube video URL"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2.5 text-sm outline-none focus:border-ember"
            />
            <Button type="submit" variant="primary">Load video</Button>
          </form>
          {youtubeError && <p role="alert" className="text-sm text-red-400">{youtubeError}</p>}
          {youtubeId && (
            <div className="space-y-3">
              <div className="aspect-video max-w-3xl overflow-hidden rounded-xl border border-line bg-black">
                <iframe
                  title="YouTube video preview"
                  src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
              <p className="text-sm text-mute">Link preview loaded. Directly turning a YouTube URL into downloadable clips is not enabled yet. To edit now, choose <strong>Import video</strong> and select your authorized source file.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={start} busy={busy}><FilePlus2 className="h-4 w-4" /> Import source file</Button>
                <Button onClick={() => { setYoutubeId(null); setYoutubeUrl(""); setYoutubeError(null); }}>Clear link</Button>
              </div>
            </div>
          )}
        </Panel>

        <div className="grid grid-cols-3 gap-4">
          <Stat label="Projects" value={projects.length} />
          <Stat label="Clips marked" value={clipCount} />
          <Stat label="Projects exported" value={exported} />
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent projects</h2>
            {projects.length > 5 && (
              <button className="text-xs text-ember hover:underline" onClick={() => onNavigate("projects")}>
                View all
              </button>
            )}
          </div>
          {loading ? (
            <Spinner label="Loading projects…" />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Clapperboard className="h-9 w-9" />}
              title="No projects yet"
              body="Import a video file to create your first project. Your video stays on your device; ClipForge only reads it."
              action={
                <Button variant="primary" onClick={start} busy={busy}>
                  <FilePlus2 className="h-4 w-4" /> Import video
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {recent.map((p) => {
                const status = projectStatus(p, false);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onOpen(p.id)}
                      className="flex w-full items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3 text-left hover:border-[#3a3a47]"
                    >
                      <Scissors className="h-5 w-5 shrink-0 text-ember" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{p.name}</span>
                        <span className="block truncate font-mono text-[11px] text-mute">
                          {p.source ? `${p.source.file_name} · ${p.source.width}×${p.source.height} · ${formatDuration(p.source.duration)}` : "No video"}
                        </span>
                      </span>
                      <span className="text-xs text-mute">{p.clips.length} clip{p.clips.length === 1 ? "" : "s"}</span>
                      <Badge tone={status === "Exported" ? "ember" : status === "Ready" ? "ok" : "neutral"}>{status}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Panel className="flex items-center gap-4 p-4">
          <Sparkles className="h-5 w-5 shrink-0 text-ember" aria-hidden />
          <div className="flex-1 text-sm">
            <span className="font-medium">AI highlight detection and captions are planned, not included yet.</span>{" "}
            <span className="text-mute">This version is a precise clip editor and exporter. See what's coming on the roadmap.</span>
          </div>
          <Button onClick={() => onNavigate("roadmap")}>Roadmap</Button>
        </Panel>
      </div>

      {busy && (
        <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-xl border border-line bg-raised px-4 py-3 shadow-xl sm:inset-x-auto sm:right-6 sm:w-[min(34rem,calc(100vw-2rem))]">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="font-medium">Importing video and reading its metadata…</span>
            <span className="shrink-0 text-[11px] text-mute">{elapsedLabel}</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel">
            <div className="h-full w-1/3 rounded-full bg-ember animate-pulse" />
          </div>
          <p className="mt-2 text-[11px] text-mute">Time depends on the file size and format. This is processing, not an upload.</p>
        </div>
      )}
    </>
  );
}
