import { useEffect, useRef, useState } from "react";
import { Music, Music2, Play, Undo2 } from "lucide-react";
import { lyricLines, lyricsFromTaps, spreadLyrics, type CaptionLine, type LyricTap } from "../lib/captions";
import { formatTime } from "../lib/time";
import { Button } from "./ui";

/** People tap a little after they hear the line start; pull each tap back by this much. */
const TAP_LATENCY = 0.15;
/** Ignore a second tap this soon after the last one (double presses). */
const MIN_GAP = 0.25;

interface Props {
  range: { start: number; end: number };
  playhead: number;
  existing: CaptionLine[];
  onApply: (next: CaptionLine[], message: string) => void;
  onPlayFrom: (t: number) => void;
  onPause: () => void;
  disabled?: boolean;
}

/** Replace captions inside [start, end], keep everything outside it. */
function mergeRange(existing: CaptionLine[], next: CaptionLine[], start: number, end: number): CaptionLine[] {
  return [...existing.filter((l) => l.end <= start || l.start >= end), ...next].sort((a, b) => a.start - b.start);
}

export function LyricsSync({ range, playhead, existing, onApply, onPlayFrom, onPause, disabled }: Props) {
  const [text, setText] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [taps, setTaps] = useState<LyricTap[]>([]);
  const texts = lyricLines(text);
  const phRef = useRef(playhead);
  phRef.current = playhead;
  const tapsRef = useRef(taps);
  tapsRef.current = taps;
  const textsRef = useRef(texts);
  textsRef.current = texts;

  const finish = (got: LyricTap[]) => {
    onPause();
    setSyncing(false);
    const lines = lyricsFromTaps(textsRef.current, got, range.end);
    if (!lines.length) { onApply(existing, "No lines were timed."); return; }
    const left = textsRef.current.length - lines.length;
    onApply(mergeRange(existing, lines, range.start, range.end), `Timed ${lines.length} lyric lines${left > 0 ? `; ${left} more were not tapped, so they were left out` : ""}. Fix any line with "Set to playhead".`);
  };

  const tap = () => {
    const prev = tapsRef.current;
    if (prev.filter((x) => !x.gap).length >= textsRef.current.length) return; // every line is timed; Finish or mark music-only
    const t = Math.max(range.start, phRef.current - TAP_LATENCY);
    if (prev.length && t - prev[prev.length - 1].t < MIN_GAP) return;
    setTaps([...prev, { t }]);
  };

  /** Singing stops here and only music plays: the caption ends and stays off until the next line is tapped. */
  const musicOnly = () => {
    const prev = tapsRef.current;
    if (!prev.length || prev[prev.length - 1].gap) return;
    const t = Math.max(range.start, phRef.current - TAP_LATENCY);
    if (t - prev[prev.length - 1].t < MIN_GAP) return;
    setTaps([...prev, { t, gap: true }]);
  };

  const undo = () => {
    const prev = tapsRef.current;
    if (!prev.length) return;
    const next = prev.slice(0, -1);
    setTaps(next);
    onPlayFrom(Math.max(range.start, prev[prev.length - 1].t - 2));
  };

  const begin = () => {
    if (!texts.length) return;
    setTaps([]);
    setSyncing(true);
    onPlayFrom(range.start);
  };

  const cancel = () => { onPause(); setSyncing(false); setTaps([]); };

  // While syncing, Space/Enter taps and Backspace undoes. Captured so the editor's own Space (play/pause) doesn't also fire.
  useEffect(() => {
    if (!syncing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === "keydown" && !e.repeat) tap(); }
      else if (e.key.toLowerCase() === "m") { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === "keydown" && !e.repeat) musicOnly(); }
      else if (e.key === "Backspace" && e.type === "keydown") { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
      else if (e.key === "Escape" && e.type === "keydown") { cancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onKey, true); };
    // tap/undo/cancel read refs and range only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing, range.start, range.end]);

  const i = taps.filter((x) => !x.gap).length;
  const inGap = taps.length > 0 && !!taps[taps.length - 1].gap;
  const allTimed = i >= texts.length;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-line p-3">
      <div className="flex items-center gap-2 text-[12px] font-medium"><Music className="h-3.5 w-3.5 text-ember" aria-hidden /> Songs: use the lyrics</div>
      {!syncing ? (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} disabled={disabled}
            placeholder={"Paste the lyrics here, one caption per line.\nYou can also import a synced .lrc or .srt file above."}
            aria-label="Song lyrics" className="w-full resize-y rounded-md border border-line bg-panel px-2 py-1.5 text-[13px] leading-snug text-ink focus:border-ember focus:outline-none" />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={disabled || !texts.length} onClick={begin}><Play className="h-4 w-4" /> Tap to sync{texts.length ? ` (${texts.length} lines)` : ""}</Button>
            <Button disabled={disabled || !texts.length} onClick={() => onApply(mergeRange(existing, spreadLyrics(texts, range.start, range.end), range.start, range.end), `Spread ${texts.length} lines evenly across ${formatTime(range.start)}–${formatTime(range.end)}. It is only a rough draft; use Tap to sync for real timing.`)}>Spread evenly</Button>
          </div>
          <p className="text-[11px] leading-snug text-mute">Tap to sync plays the selected range. Press Space as each line starts being sung, and M where only music plays (the caption hides until the next line). It uses the timing you give it, so it works for any language.</p>
        </>
      ) : (
        <div className="space-y-2" role="group" aria-label="Tap to sync">
          <div className="text-[11px] text-mute">{allTimed ? "All lines timed" : `Line ${i + 1} of ${texts.length}`} · {formatTime(playhead)}</div>
          {i > 0 && <div className="truncate text-[12px] text-mute">{texts[i - 1]}</div>}
          <div className="rounded-md bg-raised px-3 py-3 text-center text-[16px] font-medium leading-snug text-ink">{allTimed ? "Press Music only when the last line ends, then Finish." : texts[i]}</div>
          {texts[i + 1] && <div className="truncate text-[12px] text-mute">Next: {texts[i + 1]}</div>}
          {inGap && <div className="text-center text-[12px] text-warn">♪ Music only: no caption is shown until you tap the next line</div>}
          <button onPointerDown={(e) => { e.preventDefault(); tap(); }} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.preventDefault(); }} disabled={allTimed}
            className="w-full rounded-lg bg-ember py-3 text-[14px] font-semibold text-black active:scale-[0.99] disabled:opacity-40">
            Tap when this line starts <kbd className="ml-1 rounded bg-black/15 px-1 font-mono text-[11px]">Space</kbd>
          </button>
          <button onPointerDown={(e) => { e.preventDefault(); musicOnly(); }} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.preventDefault(); }} disabled={!taps.length || inGap}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-raised py-2 text-[13px] text-ink hover:border-[#3a3a47] disabled:opacity-40">
            <Music2 className="h-4 w-4" /> Music only, singing stopped <kbd className="rounded bg-bg px-1 font-mono text-[11px] text-mute">M</kbd>
          </button>
          <div className="flex gap-2">
            <Button onClick={undo} disabled={!taps.length}><Undo2 className="h-4 w-4" /> Undo</Button>
            <Button className="flex-1" onClick={() => finish(taps)} disabled={!i}>Finish ({i} timed)</Button>
            <Button variant="danger" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
