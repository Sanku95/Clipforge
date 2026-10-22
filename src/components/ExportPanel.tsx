import { useEffect, useRef, useState } from "react";
import { FolderOpen, Rocket, Square, Check, X } from "lucide-react";
import { api, isDesktop, pickFolder } from "../lib/api";
import type { ClipOutcome, ExportProgress, Preset, Project } from "../lib/types";
import { formatBytes, formatDuration } from "../lib/time";
import { defaultStyle } from "../lib/captions";
import { hasEffects } from "../lib/effects";
import { Button, ErrorBanner, Panel, SuccessBanner } from "./ui";

const PRESETS: { id: Preset; label: string; sub: string; box: string }[] = [
  { id: "vertical", label: "9:16", sub: "Shorts · Reels · TikTok", box: "h-8 w-[18px]" },
  { id: "square", label: "1:1", sub: "Square feed", box: "h-6 w-6" },
  { id: "landscape", label: "16:9", sub: "YouTube", box: "h-[18px] w-8" },
  { id: "original", label: "Original", sub: "Keep source framing", box: "h-6 w-8 border-dashed" }
];

interface Props {
  project: Project;
  sourceMissing: boolean;
  onChange: (patch: (p: Project) => Project) => void;
}

export function ExportPanel({ project, sourceMissing, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [outcomes, setOutcomes] = useState<ClipOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultDir, setDefaultDir] = useState<string>("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api.defaultOutputDir().then(setDefaultDir).catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, []);

  const outDir = project.outputDir ?? defaultDir;
  const needsCrop = project.preset !== "original";
  const canExport = !busy && !sourceMissing && project.clips.length > 0 && !!project.source;

  const chooseFolder = async () => {
    const dir = await pickFolder(outDir || undefined);
    if (dir) onChange((p) => ({ ...p, outputDir: dir }));
  };

  const run = async () => {
    if (!project.source) return;
    setError(null);
    setOutcomes(null);
    setProgress({});
    setBusy(true);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await api.onExportProgress((p: ExportProgress) => {
        if (mounted.current) setProgress((prev) => ({ ...prev, [p.clip_id]: p.fraction }));
      });
      const burn = (project.burnCaptions ?? true) && (project.captions?.length ?? 0) > 0 && !isDesktop();
      const results = await api.exportClips({
        source: project.source.path,
        out_dir: outDir,
        preset: project.preset,
        pan: project.pan,
        clips: project.clips.map((c) => ({ id: c.id, name: c.name, start: c.start, end: c.end })),
        ...(hasEffects(project.effects) && !isDesktop() ? { effects: { settings: project.effects!, srcWidth: project.source.width, srcHeight: project.source.height } } : {}),
        ...(burn ? { captions: { lines: project.captions ?? [], style: project.captionStyle ?? defaultStyle("pop"), srcWidth: project.source.width, srcHeight: project.source.height } } : {})
      });
      if (!mounted.current) return;
      setOutcomes(results);
      const okCount = results.filter((r) => r.ok).length;
      if (okCount > 0) {
        onChange((p) => ({ ...p, lastExport: { at: new Date().toISOString(), files: okCount } }));
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      unlisten?.();
      if (mounted.current) setBusy(false);
    }
  };

  const okOutcomes = outcomes?.filter((o) => o.ok) ?? [];
  const failed = outcomes?.filter((o) => !o.ok) ?? [];
  const nameOf = (id: string) => project.clips.find((c) => c.id === id)?.name ?? "Clip";

  return (
    <Panel className="p-4">
      <h3 className="mb-3 text-sm font-semibold">Export</h3>

      <div role="radiogroup" aria-label="Export format" className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => {
          const active = project.preset === p.id;
          return (
            <button
              key={p.id}
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => onChange((pr) => ({ ...pr, preset: p.id }))}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                active ? "border-ember bg-ember/10" : "border-line bg-raised hover:border-[#3a3a47]"
              }`}
            >
              <span className={`shrink-0 rounded-[3px] border-2 ${active ? "border-ember" : "border-mute"} ${p.box}`} aria-hidden />
              <span>
                <span className="block text-[13px] font-medium">{p.label}</span>
                <span className="block text-[11px] text-mute">{p.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {needsCrop && (
        <div className="mt-3">
          <label className="flex items-center justify-between text-[11px] uppercase tracking-wider text-mute" htmlFor="pan">
            <span>Crop position</span>
            <span className="font-mono normal-case">{project.pan === 0.5 ? "centered" : `${Math.round(project.pan * 100)}%`}</span>
          </label>
          <input
            id="pan"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={project.pan}
            disabled={busy}
            onChange={(e) => onChange((p) => ({ ...p, pan: Number(e.target.value) }))}
            className="mt-1 w-full accent-[#ff6a2b]"
          />
          <p className="mt-1 text-[11px] text-mute">
            Fills the frame by cropping. Slide to choose which part of the picture is kept. (Fixed crop; no face tracking.)
          </p>
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-mute">Save to</div>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border border-line bg-raised px-3 py-2 font-mono text-[12px]" title={outDir}>
            {outDir || "…"}
          </div>
          {isDesktop() && <Button onClick={chooseFolder} disabled={busy} aria-label="Choose output folder">
            <FolderOpen className="h-4 w-4" /> Choose
          </Button>}
        </div>
        <p className="mt-1 text-[11px] text-mute">Your original video is never modified. In the browser, clips are encoded on your device and download as MP4 files.</p>
      </div>

      <div className="mt-4 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={run} disabled={!canExport} busy={busy}>
          <Rocket className="h-4 w-4" />
          {busy ? "Exporting…" : `Export ${project.clips.length || ""} clip${project.clips.length === 1 ? "" : "s"}`.replace("  ", " ")}
        </Button>
        {busy && (
          <Button variant="danger" onClick={() => void api.cancelExport()} aria-label="Cancel export">
            <Square className="h-3.5 w-3.5" /> Cancel
          </Button>
        )}
      </div>
      {project.clips.length === 0 && <p className="mt-2 text-[11px] text-mute">Add at least one clip to export.</p>}
      {sourceMissing && <p className="mt-2 text-[11px] text-bad">Reconnect the source video before exporting.</p>}

      {(busy || outcomes) && (
        <ul className="mt-4 space-y-2" aria-label="Export progress">
          {project.clips.map((c) => {
            const outcome = outcomes?.find((o) => o.clip_id === c.id);
            const f = outcome ? (outcome.ok ? 1 : progress[c.id] ?? 0) : progress[c.id] ?? 0;
            return (
              <li key={c.id} className="text-[12px]">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate">{c.name}</span>
                  <span className="shrink-0 font-mono text-mute">
                    {outcome ? (outcome.ok ? <Check className="h-3.5 w-3.5 text-ok" aria-label="done" /> : <X className="h-3.5 w-3.5 text-bad" aria-label="failed" />) : `${Math.round(f * 100)}%`}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className={`h-full rounded-full transition-[width] ${outcome && !outcome.ok ? "bg-bad" : "bg-ember"}`}
                    style={{ width: `${Math.round(f * 100)}%` }}
                    role="progressbar"
                    aria-valuenow={Math.round(f * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progress for ${c.name}`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 space-y-2">
        {error && <ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner>}
        {failed.map((o) => (
          <ErrorBanner key={o.clip_id}>
            <strong>{nameOf(o.clip_id)}:</strong> {o.error}
          </ErrorBanner>
        ))}
        {okOutcomes.length > 0 && (
          <SuccessBanner>
            <div className="font-medium">
              Exported {okOutcomes.length} clip{okOutcomes.length === 1 ? "" : "s"} and verified {okOutcomes.length === 1 ? "it" : "them"}.
            </div>
            <ul className="mt-1.5 space-y-1">
              {okOutcomes.map((o) => (
                <li key={o.clip_id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate text-ink/90">
                    {nameOf(o.clip_id)} · {o.width}×{o.height} · {formatDuration(o.duration ?? 0)} · {formatBytes(o.size_bytes ?? 0)}
                  </span>
                  <button
                    className="shrink-0 text-ember hover:underline"
                    onClick={() => o.output_path && void api.revealInFinder(o.output_path).catch((e: Error) => setError(e.message))}
                  >
                    {isDesktop() ? "Show in Finder" : "Downloaded"}
                  </button>
                </li>
              ))}
            </ul>
          </SuccessBanner>
        )}
      </div>
    </Panel>
  );
}
