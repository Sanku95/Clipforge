import { useEffect, useRef, useState } from "react";
import { Music, Play, Undo2 } from "lucide-react";
import { lyricLines, lyricsFromTaps, spreadLyrics, type CaptionLine } from "../lib/captions";
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
  const [taps, setTaps] = useState<number[]>([]);
  const texts = lyricLines(text);
  const phRef = useRef(playhead);
  phRef.current = playhead;
  const tapsRef = useRef(taps);
  tapsRef.current = taps;
  const textsRef = useRef(texts);
  textsRef.current = texts;

  const finish = (got: number[]) => {
    onPause();
    setSyncing(false);
    const lines = lyricsFromTaps(textsRef.current, got, range.end);
    if (!lines.length) { onApply(existing, "No lines were timed."); return; }
    const left = textsRef.current.length - lines.length;
    onApply(mergeRange(existing, lines, range.start, range.end), `Timed ${lines.length} lyric lines${left > 0 ? `; ${left} more were not tapped, so they were left out` : ""}. Fix any line with "Set to playhead".`);
  };

  const tap = () => {
    const prev = tapsRef.current;
    const t = Math.max(range.start, phRef.current - TAP_LATENCY);
    if (prev.length && t - prev[prev.length - 1] < MIN_GAP) return;
    const next = [...prev, t];
    setTaps(next);
    if (next.length >= textsRef.current.length) finish(next);
  };

  const undo = () => {
    const prev = tapsRef.current;
    if (!prev.length) return;
    const next = prev.slice(0, -1);
    setTaps(next);
    onPlayFrom(Math.max(range.start, prev[prev.length - 1] - 2));
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
      else if (e.key === "Backspace" && e.type === "keydown") { e.preventDefault(); e.stopImmediatePropagation(); undo(); }
      else if (e.key === "Escape" && e.type === "keydown") { cancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); window.removeEventListener("keyup", onKey, true); };
    // tap/undo/cancel read refs and range only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncing, range.start, range.end]);

  const i = taps.length;
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
          <p className="text-[11px] leading-snug text-mute">Tap to sync plays the selected range. Press Space as each line starts being sung. It uses the timing you give it, so it works for any language.</p>
        </>
      ) : (
        <div className="space-y-2" role="group" aria-label="Tap to sync">
          <div className="text-[11px] text-mute">Line {Math.min(i + 1, texts.length)} of {texts.length} · {formatTime(playhead)}</div>
          {i > 0 && <div className="truncate text-[12px] text-mute">{texts[i - 1]}</div>}
          <div className="rounded-md bg-raised px-3 py-3 text-center text-[16px] font-medium leading-snug text-ink">{texts[i]}</div>
          {texts[i + 1] && <div className="truncate text-[12px] text-mute">Next: {texts[i + 1]}</div>}
          <button onPointerDown={(e) => { e.preventDefault(); tap(); }} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") e.preventDefault(); }}
            className="w-full rounded-lg bg-ember py-3 text-[14px] font-semibold text-black active:scale-[0.99]">
            Tap when this line starts <kbd className="ml-1 rounded bg-black/15 px-1 font-mono text-[11px]">Space</kbd>
          </button>
          <div className="flex gap-2">
            <Button onClick={undo} disabled={!i}><Undo2 className="h-4 w-4" /> Undo</Button>
            <Button className="flex-1" onClick={() => finish(taps)} disabled={!i}>Finish ({i} timed)</Button>
            <Button variant="danger" onClick={cancel}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
