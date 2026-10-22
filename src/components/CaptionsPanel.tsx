import { useRef, useState } from "react";
import { Captions as CaptionsIcon, Download, FileUp, Mic, Trash2 } from "lucide-react";
import { api, type TranscribeOptions, type TranscribeStatus } from "../lib/api";
import { CAPTION_PRESETS, applyPreset, defaultStyle, parseSrt, toSrt, type CaptionLine, type CaptionPosition, type CaptionStyle } from "../lib/captions";
import { formatTime } from "../lib/time";
import type { Project } from "../lib/types";
import { Button, ErrorBanner, Panel } from "./ui";
import { CaptionText, useCaptionFonts } from "./CaptionOverlay";

const LANGS: [string, string][] = [["auto", "Auto-detect"], ["english", "English"], ["hindi", "Hindi"], ["kannada", "Kannada"], ["tamil", "Tamil"], ["telugu", "Telugu"], ["malayalam", "Malayalam"], ["marathi", "Marathi"], ["bengali", "Bengali"], ["gujarati", "Gujarati"], ["punjabi", "Punjabi"], ["urdu", "Urdu"], ["spanish", "Spanish"], ["portuguese", "Portuguese"], ["french", "French"], ["german", "German"], ["arabic", "Arabic"], ["indonesian", "Indonesian"], ["japanese", "Japanese"], ["korean", "Korean"]];
const MODELS: { id: TranscribeOptions["model"]; label: string }[] = [
  { id: "tiny", label: "Fast (about 40 MB download)" },
  { id: "base", label: "Better accuracy (about 80 MB download)" },
  { id: "small", label: "Best for Indian languages and songs (about 250 MB, slower)" }
];
const POSITIONS: CaptionPosition[] = ["top", "middle", "bottom"];

interface Props {
  project: Project;
  /** Current in/out selection on the source timeline. */
  range: { start: number; end: number };
  onChange: (patch: (p: Project) => Project) => void;
  onSeek: (t: number) => void;
}

export function CaptionsPanel({ project, range, onChange, onSeek }: Props) {
  useCaptionFonts();
  const src = project.source;
  const lines = project.captions ?? [];
  const style = project.captionStyle ?? defaultStyle("pop");
  const [lang, setLang] = useState("auto");
  const [model, setModel] = useState<TranscribeOptions["model"]>("tiny");
  const [scope, setScope] = useState<"range" | "all">("range");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TranscribeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setLines = (next: CaptionLine[]) => onChange((p) => ({ ...p, captions: next, burnCaptions: p.burnCaptions ?? true, captionStyle: p.captionStyle ?? defaultStyle("pop") }));
  const setStyle = (next: CaptionStyle) => onChange((p) => ({ ...p, captionStyle: next }));

  const generate = async () => {
    if (!src) return;
    setError(null); setNotice(null); setBusy(true); setStatus({ stage: "audio", fraction: null });
    try {
      const start = scope === "all" ? 0 : range.start, end = scope === "all" ? src.duration : range.end;
      const got = await api.transcribeVideo(src.path, start, end, { language: lang, model }, setStatus);
      if (!got.length) { setNotice("No speech was found in that range."); return; }
      // Replace captions inside the transcribed range, keep the rest.
      const kept = lines.filter((l) => l.end <= start || l.start >= end);
      setLines([...kept, ...got].sort((a, b) => a.start - b.start));
      setNotice(`Added ${got.length} caption lines. Check them for mistakes, especially names and numbers.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not detect speech.");
    } finally {
      setBusy(false); setStatus(null);
    }
  };

  const importSrt = async (file: File) => {
    setError(null); setNotice(null);
    try {
      const parsed = parseSrt(await file.text());
      if (!parsed.length) throw new Error("No captions were found in that file. Is it a .srt subtitle file?");
      setLines(parsed);
      setNotice(`Imported ${parsed.length} caption lines.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const downloadSrt = () => {
    const blob = new Blob([toSrt(lines)], { type: "application/x-subrip" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `${project.name.replace(/[^a-z0-9-_ ]/gi, "").trim() || "captions"}.srt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  const editLine = (id: string, patch: Partial<CaptionLine>) => setLines(lines.map((l) => (l.id === id ? { ...l, ...patch, words: patch.text !== undefined ? undefined : l.words } : l)));
  const statusText = status ? (status.stage === "audio" ? "Reading the audio…" : status.stage === "model" ? `Downloading the speech model${status.fraction != null ? ` ${Math.round(status.fraction * 100)}%` : "…"}` : `Listening${status.fraction != null ? ` ${Math.round(status.fraction * 100)}%` : "…"}`) : "";

  return (
    <Panel className="p-4" >
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[14px] font-medium"><CaptionsIcon className="h-4 w-4 text-ember" aria-hidden /> Captions</h2>
        {lines.length > 0 && <span className="text-[11px] text-mute">{lines.length} lines</span>}
      </div>

      <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-mute">Language
            <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy} className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] text-ink">
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-mute">Listen to
            <select value={scope} onChange={(e) => setScope(e.target.value as "range" | "all")} disabled={busy} className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] text-ink">
              <option value="range">Selected range ({formatTime(range.start)}–{formatTime(range.end)})</option>
              <option value="all">Whole video</option>
            </select>
          </label>
        </div>
        <label className="block text-[11px] text-mute">Speech model
          <select value={model} onChange={(e) => setModel(e.target.value as TranscribeOptions["model"])} disabled={busy} className="mt-1 w-full rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] text-ink">
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <p className="text-[11px] leading-snug text-mute">Pick the spoken language instead of Auto-detect. Songs with music are hard for speech models, so expect mistakes there. If the text is wrong, import a .srt or edit the lines below.</p>
        <div className="flex gap-2">
          <Button variant="primary" className="flex-1" onClick={generate} busy={busy} disabled={!src}><Mic className="h-4 w-4" /> {busy ? statusText : "Generate from speech"}</Button>
          <Button onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Import a .srt subtitle file"><FileUp className="h-4 w-4" /> .srt</Button>
          <input ref={fileRef} type="file" accept=".srt,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSrt(f); e.target.value = ""; }} />
        </div>
        <p className="text-[11px] leading-relaxed text-mute">Speech is detected on your device; the audio is not uploaded. The first run downloads the speech model from huggingface.co once, and your browser keeps it. Long videos can take several minutes, so keep this tab open.</p>
      </div>

      {error && <div className="mt-3"><ErrorBanner onDismiss={() => setError(null)}>{error}</ErrorBanner></div>}
      {notice && <p role="status" className="mt-3 text-[12px] text-mute">{notice}</p>}

      {lines.length > 0 && (
        <>
          <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1" aria-label="Caption lines">
            {lines.map((l) => (
              <li key={l.id} className="flex items-start gap-2">
                <button className="mt-1.5 w-[74px] shrink-0 rounded bg-raised px-1 py-0.5 text-left font-mono text-[10px] text-mute hover:text-ink" onClick={() => onSeek(l.start)} title="Jump to this caption">{formatTime(l.start)}</button>
                <textarea value={l.text} rows={Math.min(3, Math.max(1, Math.ceil(l.text.length / 34)))} onChange={(e) => editLine(l.id, { text: e.target.value })} aria-label={`Caption at ${formatTime(l.start)}`} className="min-w-0 flex-1 resize-none rounded-md border border-line bg-panel px-2 py-1 text-[13px] leading-snug text-ink focus:border-ember focus:outline-none" />
                <button onClick={() => setLines(lines.filter((x) => x.id !== l.id))} className="mt-1 rounded p-1 text-mute hover:text-bad" aria-label="Delete caption line"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>

          <div className="mt-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-mute">Style</div>
            <div role="radiogroup" aria-label="Caption style" className="mt-2 grid grid-cols-3 gap-2">
              {CAPTION_PRESETS.map((p) => {
                const active = style.preset === p.id;
                const sample: CaptionLine = { id: "s", start: 0, end: 1, text: "Sample", words: [{ t: "Sample", s: 0, e: 0.5 }] };
                const st = applyPreset(style, p.id);
                return (
                  <button key={p.id} role="radio" aria-checked={active} onClick={() => setStyle({ ...applyPreset(style, p.id) })} title={p.hint}
                    className={`flex h-[68px] flex-col items-center justify-between rounded-lg border p-1.5 text-center transition-colors ${active ? "border-ember bg-ember/10" : "border-line bg-raised hover:border-[#3a3a47]"}`}>
                    <span className="flex flex-1 items-center justify-center overflow-hidden rounded bg-[#2a2a33] px-1"><CaptionText line={sample} t={1} style={st} px={15} /></span>
                    <span className="mt-1 text-[10px] text-mute">{p.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-mute">
              <label>Size {style.size}%
                <input type="range" min={60} max={160} step={5} value={style.size} onChange={(e) => setStyle({ ...style, size: Number(e.target.value) })} className="mt-1 w-full accent-[#ff7a3d]" />
              </label>
              <label>Colour
                <input type="color" value={style.accent} onChange={(e) => setStyle({ ...style, accent: e.target.value.toUpperCase() })} className="mt-1 h-7 w-full cursor-pointer rounded border border-line bg-panel" aria-label="Caption accent colour" />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div role="radiogroup" aria-label="Caption position" className="inline-flex overflow-hidden rounded-lg border border-line text-[12px]">
                {POSITIONS.map((pos) => (
                  <button key={pos} role="radio" aria-checked={style.position === pos} onClick={() => setStyle({ ...style, position: pos })} className={`px-3 py-1 capitalize ${style.position === pos ? "bg-ember text-black" : "bg-raised text-ink hover:bg-panel"}`}>{pos}</button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={style.uppercase} onChange={(e) => setStyle({ ...style, uppercase: e.target.checked })} /> UPPERCASE</label>
            </div>
          </div>

          <label className="mt-4 flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={project.burnCaptions ?? true} onChange={(e) => onChange((p) => ({ ...p, burnCaptions: e.target.checked }))} />
            <span>Burn captions into exported videos<span className="block text-[11px] text-mute">The preview approximates the final look; check an exported clip before posting.</span></span>
          </label>
          <div className="mt-3 flex gap-2">
            <Button onClick={downloadSrt}><Download className="h-4 w-4" /> Download .srt</Button>
            <Button variant="danger" onClick={() => { if (confirm("Remove all captions from this project?")) onChange((p) => ({ ...p, captions: [] })); }}>Clear</Button>
          </div>
        </>
      )}
    </Panel>
  );
}
