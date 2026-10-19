import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPreviewState, onPreviewState, videoSrc, prepareSegmentPreview, type PreviewState } from "../lib/api";
import { ArrowLeft, FilePlus2, Film, Pause, Play, PlayCircle, RefreshCw, Save } from "lucide-react";
import { api, pickVideo } from "../lib/api";
import { newId, projectStatus, useProjects } from "../lib/projects";
import type { Clip } from "../lib/types";
import { formatDuration, formatTime } from "../lib/time";
import { Timeline } from "../components/Timeline";
import { TimeInput } from "../components/TimeInput";
import { ClipList } from "../components/ClipList";
import { ExportPanel } from "../components/ExportPanel";
import { Badge, Button, ErrorBanner, Panel, Spinner } from "../components/ui";

const MIN_CLIP = 0.5;
const PRESET_RATIO: Record<string, string | null> = { vertical: "9 / 16", square: "1 / 1", landscape: "16 / 9", original: null };
const PRESET_LABEL: Record<string, string> = { vertical: "9:16", square: "1:1", landscape: "16:9", original: "Original" };
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const isDesktopBrowser = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function Workspace({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { projects, update } = useProjects();
  const project = projects.find((p) => p.id === projectId);
  const source = project?.source ?? null;
  const duration = source?.duration ?? 0;
  const frameRatio = project ? PRESET_RATIO[project.preset] : null;

  const videoRef = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(Math.min(duration, 30));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [preview, setPreview] = useState<PreviewState | undefined>(undefined);
  const [checking, setChecking] = useState(true);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [relinking, setRelinking] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [segmentOffset, setSegmentOffset] = useState(0);
  const [segmentEnd, setSegmentEnd] = useState(0);
  const [preparingSegment, setPreparingSegment] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSourceUrl(null);
    setSegmentOffset(0);
    setSegmentEnd(0);
    setPreviewFailed(false);
    if (!source) return;
    const path = source.path;
    const load = () =>
      videoSrc(path)
        .then((url) => { if (!cancelled) { setPreviewFailed(false); setSourceUrl(url); } })
        .catch((e) => { if (!cancelled && !(e instanceof Error && e.message === "preview-pending")) setPreviewFailed(true); });
    setPreview(getPreviewState(path));
    void load();
    // Formats the browser can't play get a small preview copy built in the background.
    const off = onPreviewState(path, (st) => {
      if (cancelled) return;
      setPreview(st);
      if (st.status === "ready") void load();
      if (st.status === "failed") setPreviewFailed(true);
    });
    return () => { cancelled = true; off(); };
  }, [source?.path]);

  // Confirm the file is still there (this also re-enables preview access).
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    if (!source) {
      setChecking(false);
      return;
    }
    api
      .probeVideo(source.path)
      .then(() => !cancelled && setSourceMissing(false))
      .catch(() => !cancelled && setSourceMissing(true))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [source?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const seek = useCallback(
    (t: number) => {
      const v = videoRef.current;
      const clamped = Math.min(duration, Math.max(0, t));
      if (v) v.currentTime = Math.max(0, Math.min(v.duration || clamped, clamped - segmentOffset));
      setPlayhead(clamped);
    },
    [duration, segmentOffset]
  );

  // Smooth playhead while playing; stop at the end of "play selection".
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const absoluteTime = v.currentTime + segmentOffset;
        setPlayhead(absoluteTime);
        if (stopAt.current !== null && absoluteTime >= stopAt.current) {
          v.pause();
          stopAt.current = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, segmentOffset]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || previewFailed) return;
    stopAt.current = null;
    if (v.paused) void v.play().catch(() => setPreviewFailed(true));
    else v.pause();
  }, [previewFailed]);

  const playSelection = () => {
    const v = videoRef.current;
    if (!v || previewFailed) return;
    v.currentTime = Math.max(0, inPoint - segmentOffset);
    stopAt.current = outPoint;
    void v.play().catch(() => setPreviewFailed(true));
  };

  const setIn = useCallback(
    (t: number) => {
      const v = round3(Math.min(Math.max(0, t), duration));
      setInPoint(v);
      setOutPoint((o) => (o <= v + MIN_CLIP ? Math.min(duration, round3(v + MIN_CLIP)) : o));
    },
    [duration]
  );
  const setOut = useCallback(
    (t: number) => {
      const v = round3(Math.min(Math.max(0, t), duration));
      setOutPoint(v);
      setInPoint((i) => (i >= v - MIN_CLIP ? Math.max(0, round3(v - MIN_CLIP)) : i));
    },
    [duration]
  );

  // Keyboard shortcuts: Space play/pause, I / O set points, ←/→ step frames.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.getAttribute("role") === "slider") return;
      const frame = source && source.fps > 0 ? 1 / source.fps : 1 / 30;
      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "i":
          setIn(playhead);
          break;
        case "o":
          setOut(playhead);
          break;
        case "arrowleft":
          e.preventDefault();
          seek(playhead - (e.shiftKey ? 5 : frame));
          break;
        case "arrowright":
          e.preventDefault();
          seek(playhead + (e.shiftKey ? 5 : frame));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead, seek, setIn, setOut, togglePlay, source]);

  const draftError = useMemo(() => {
    if (outPoint <= inPoint) return "The out point must be after the in point.";
    if (outPoint - inPoint < MIN_CLIP) return `Clips must be at least ${MIN_CLIP} seconds long.`;
    if (outPoint > duration + 0.05) return "The out point is past the end of the video.";
    return null;
  }, [inPoint, outPoint, duration]);

  const addClip = () => {
    if (!project || draftError) return;
    const stem = (source?.file_name ?? "clip").replace(/\.[^.]+$/, "");
    const clip: Clip = { id: newId(), name: `${stem} – clip ${project.clips.length + 1}`, start: inPoint, end: outPoint };
    update(project.id, (p) => ({ ...p, clips: [...p.clips, clip] }));
    setSelectedId(clip.id);
    setNotice(null);
  };

  const updateSelected = () => {
    if (!project || !selectedId || draftError) return;
    update(project.id, (p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === selectedId ? { ...c, start: inPoint, end: outPoint } : c))
    }));
  };

  const selectClip = (c: Clip) => {
    setSelectedId(c.id);
    setInPoint(c.start);
    setOutPoint(c.end);
    seek(c.start);
  };

  const relink = async () => {
    if (!project) return;
    setRelinking(true);
    setNotice(null);
    try {
      const path = await pickVideo();
      if (!path) return;
      const info = await api.probeVideo(path);
      update(project.id, (p) => ({ ...p, source: info }));
      setSourceMissing(false);
      setPreviewFailed(false);
      const tooLong = project.clips.filter((c) => c.end > info.duration + 0.05).length;
      if (tooLong > 0) setNotice(`${tooLong} clip(s) end after the new video's length. Adjust them before exporting.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRelinking(false);
    }
  };

  if (!project) {
    return (
      <div className="p-8">
        <ErrorBanner>This project no longer exists.</ErrorBanner>
        <Button className="mt-4" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const status = projectStatus(project, sourceMissing);
  const tone = status === "Ready" ? "ok" : status === "Exported" ? "ember" : status === "Source missing" ? "bad" : "neutral";
  const selectedClip = project.clips.find((c) => c.id === selectedId) ?? null;
  const selectedDirty = !!selectedClip && (selectedClip.start !== inPoint || selectedClip.end !== outPoint);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line px-6 py-3">
        <button onClick={onBack} className="rounded-lg p-1.5 text-mute hover:bg-raised hover:text-ink" aria-label="Back to projects">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <input
          value={project.name}
          onChange={(e) => update(project.id, (p) => ({ ...p, name: e.target.value }))}
          aria-label="Project name"
          className="min-w-0 flex-1 rounded bg-transparent px-1 text-lg font-semibold outline-none focus:bg-raised"
        />
        {source && (
          <span className="hidden font-mono text-xs text-mute md:inline">
            {source.width}×{source.height} · {formatDuration(source.duration)} · {source.video_codec}
          </span>
        )}
        <Badge tone={tone}>{status}</Badge>
      </header>

      {!source ? (
        <div className="p-6">
          <Panel className="p-6">
            <p className="mb-3 text-sm text-mute">This project has no video yet.</p>
            <Button variant="primary" busy={relinking} onClick={relink}>
              <FilePlus2 className="h-4 w-4" /> Import a video
            </Button>
            {notice && <div className="mt-3"><ErrorBanner>{notice}</ErrorBanner></div>}
          </Panel>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_380px] gap-5 overflow-y-auto p-6">
          <div className="min-w-0 space-y-4">
            {sourceMissing && !checking && (
              <ErrorBanner>
                <div className="font-medium">The source video can't be found.</div>
                <div className="mt-0.5 text-[12px]">
                  <span className="font-mono">{source.path}</span> was moved, renamed or is on a disconnected drive. Your clips are kept.
                </div>
                <Button className="mt-2" onClick={relink} busy={relinking}>
                  <RefreshCw className="h-4 w-4" /> Locate video…
                </Button>
              </ErrorBanner>
            )}
            {notice && <ErrorBanner onDismiss={() => setNotice(null)}>{notice}</ErrorBanner>}

            <Panel className="overflow-hidden">
              <div className="flex aspect-video items-center justify-center bg-black">
                {checking ? (
                  <Spinner label="Checking video…" />
                ) : sourceMissing ? (
                  <div className="text-sm text-mute">Video unavailable</div>
                ) : preview?.status === "pending" ? (
                  <div className="max-w-sm px-6 text-center text-sm text-mute" role="status" aria-live="polite">
                    <Spinner label={`Preparing a preview… ${Math.round(preview.fraction * 100)}%`} />
                    <p className="mt-2">You can already set in and out points and export. Playback appears when this finishes.</p>
                  </div>
                ) : previewFailed ? (
                  <div className="max-w-sm px-6 text-center text-sm text-mute">
                    <Film className="mx-auto mb-2 h-8 w-8 text-ember" aria-hidden />
                    <p className="font-medium text-ink">This format can't be previewed here.</p>
                    <p className="mt-1">
                      Create a short preview of just your selected in/out range. The full video stays on this device.
                    </p>
                    {!isDesktopBrowser() && <Button className="mt-3" busy={preparingSegment} disabled={!!draftError || sourceMissing} onClick={async () => {
                      setPreparingSegment(true);
                      setNotice(null);
                      try {
                        const url = await prepareSegmentPreview(source.path, inPoint, outPoint);
                        setSegmentOffset(inPoint);
                        setSegmentEnd(outPoint);
                        setSourceUrl(url);
                        setPreviewFailed(false);
                        setPlayhead(inPoint);
                      } catch (e) {
                        setNotice(e instanceof Error ? e.message : "Could not prepare this segment preview.");
                      } finally {
                        setPreparingSegment(false);
                      }
                    }}>Preview selected segment</Button>}
                  </div>
                ) : (
                  // Show exactly what will be exported: the preset's frame, cropped at the chosen position.
                  // object-fit: cover + object-position matches the export's crop window.
                  <div
                    className="relative h-full overflow-hidden"
                    style={frameRatio ? { aspectRatio: frameRatio } : { width: "100%" }}
                    data-testid="framing-preview"
                    data-preset={project.preset}
                  >
                    <video
                      ref={videoRef}
                      src={sourceUrl ?? undefined}
                      className={`h-full w-full ${frameRatio ? "object-cover" : "object-contain"}`}
                      style={frameRatio ? { objectPosition: `${project.pan * 100}% ${project.pan * 100}%` } : undefined}
                      preload="metadata"
                      playsInline
                      onPlay={() => setPlaying(true)}
                      onPause={() => {
                        setPlaying(false);
                        if (videoRef.current) setPlayhead(videoRef.current.currentTime);
                      }}
                      onSeeked={() => videoRef.current && setPlayhead(videoRef.current.currentTime + segmentOffset)}
                      onError={() => setPreviewFailed(true)}
                      aria-label="Video preview"
                    />
                    {frameRatio && (
                      <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/80">
                        {PRESET_LABEL[project.preset]} framing
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 border-t border-line px-4 py-2.5">
                <Button onClick={togglePlay} disabled={previewFailed || sourceMissing || preview?.status === "pending"} aria-label={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button onClick={playSelection} disabled={previewFailed || sourceMissing || !!draftError}>
                  <PlayCircle className="h-4 w-4" /> Play selection
                </Button>
                <span className="ml-auto font-mono text-[13px]" aria-live="off">
                  {formatTime(playhead)} <span className="text-mute">/ {formatTime(duration)}</span>
                </span>
              </div>
            </Panel>

            <Panel className="p-4">
              <Timeline
                duration={duration}
                playhead={playhead}
                inPoint={inPoint}
                outPoint={outPoint}
                clips={project.clips}
                selectedId={selectedId}
                onSeek={seek}
                onChangeIn={setIn}
                onChangeOut={setOut}
              />
              <div className="mt-4 grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <TimeInput label="In point" value={inPoint} max={duration} onCommit={setIn} />
                <TimeInput label="Out point" value={outPoint} max={duration} onCommit={setOut} />
                <div className="pb-0.5 text-right">
                  <div className="text-[11px] uppercase tracking-wider text-mute">Clip length</div>
                  <div className={`font-mono text-lg ${draftError ? "text-bad" : ""}`}>{formatTime(Math.max(0, outPoint - inPoint))}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={() => setIn(playhead)} disabled={sourceMissing}>
                  Set in at playhead <kbd className="rounded bg-bg px-1 font-mono text-[10px] text-mute">I</kbd>
                </Button>
                <Button onClick={() => setOut(playhead)} disabled={sourceMissing}>
                  Set out at playhead <kbd className="rounded bg-bg px-1 font-mono text-[10px] text-mute">O</kbd>
                </Button>
                <div className="ml-auto flex gap-2">
                  {selectedClip && (
                    <Button onClick={updateSelected} disabled={!!draftError || !selectedDirty}>
                      <Save className="h-4 w-4" /> Update clip
                    </Button>
                  )}
                  <Button variant="primary" onClick={addClip} disabled={!!draftError}>
                    <FilePlus2 className="h-4 w-4" /> Add clip
                  </Button>
                </div>
              </div>
              {draftError && <p className="mt-2 text-xs text-bad">{draftError}</p>}
              <p className="mt-3 text-[11px] text-mute">
                Shortcuts: Space play/pause · I / O set in/out · ← → step a frame · Shift+← → jump 5 s
              </p>
            </Panel>
          </div>

          <div className="min-w-0 space-y-4">
            <ClipList
              clips={project.clips}
              selectedId={selectedId}
              disabled={false}
              onSelect={selectClip}
              onRename={(id, name) =>
                update(project.id, (p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, name } : c)) }))
              }
              onRemove={(id) => {
                update(project.id, (p) => ({ ...p, clips: p.clips.filter((c) => c.id !== id) }));
                if (selectedId === id) setSelectedId(null);
              }}
            />
            <ExportPanel
              project={project}
              sourceMissing={sourceMissing}
              onChange={(patch) => update(project.id, patch)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
