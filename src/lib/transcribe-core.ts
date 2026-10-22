/** Pure helpers for speech-to-text (no DOM, no model): slicing long audio and turning Whisper output into timed words. */
import type { CaptionWord } from "./captions";

export interface Slice { start: number; end: number; keepFrom: number; keepTo: number }

/**
 * Split `total` seconds of audio into overlapping windows. Each window "owns" a span (keepFrom..keepTo) so that
 * words near a cut are taken from exactly one window and the owned spans tile the whole clip with no gaps.
 */
export function planSlices(total: number, win = 120, overlap = 4): Slice[] {
  if (!(total > 0)) return [];
  if (total <= win) return [{ start: 0, end: total, keepFrom: 0, keepTo: total }];
  const step = win - overlap;
  const out: Slice[] = [];
  for (let start = 0, k = 0; ; start += step, k++) {
    const end = Math.min(start + win, total);
    const last = end >= total;
    out.push({ start, end, keepFrom: k === 0 ? 0 : start + overlap / 2, keepTo: last ? total : end - overlap / 2 });
    if (last) break;
  }
  return out;
}

export interface AsrChunk { text: string; timestamp: [number | null, number | null] | (number | null)[] }

const NON_SPEECH = /^[[(*♪].*[\])*♪]$/;

/** Whisper word chunks -> timed words on the clip timeline (`offset` = where this audio slice starts). */
export function wordsFromChunks(chunks: AsrChunk[] | undefined, offset: number): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const c of chunks ?? []) {
    const t = (c.text ?? "").trim();
    const s = c.timestamp?.[0];
    if (!t || s == null || !Number.isFinite(s) || NON_SPEECH.test(t)) continue;
    let e = c.timestamp?.[1];
    if (e == null || !Number.isFinite(e) || e <= s) e = s + 0.35;
    words.push({ t, s: offset + s, e: offset + e });
  }
  return words;
}

/** Keep only the words whose midpoint falls inside the span a slice owns. */
export function ownedWords(words: CaptionWord[], slice: Slice): CaptionWord[] {
  return words.filter((w) => {
    const mid = (w.s + w.e) / 2;
    return mid >= slice.keepFrom && mid < slice.keepTo;
  });
}

/** Make word times monotonic and non-overlapping (Whisper's alignment can jitter by a few ms). */
export function tidyWords(words: CaptionWord[]): CaptionWord[] {
  const out: CaptionWord[] = [];
  for (const w of [...words].sort((a, b) => a.s - b.s)) {
    const prev = out[out.length - 1];
    const s = prev ? Math.max(w.s, prev.s) : w.s;
    if (prev && prev.e > s) prev.e = Math.max(prev.s + 0.05, s);
    out.push({ ...w, s, e: Math.max(w.e, s + 0.05) });
  }
  return out;
}

export type ModelSize = "tiny" | "base" | "small";
export const MODEL_IDS: Record<ModelSize, string> = {
  tiny: "onnx-community/whisper-tiny_timestamped",
  base: "onnx-community/whisper-base_timestamped",
  small: "onnx-community/whisper-small_timestamped"
};

/** Fraction of the model download finished, from transformers.js progress events (per-file or aggregate). */
export function downloadFraction(files: Map<string, { loaded: number; total: number }>): number | null {
  let loaded = 0, total = 0;
  for (const f of files.values()) { loaded += f.loaded; total += f.total; }
  return total > 0 ? Math.min(1, loaded / total) : null;
}

export type WorkerIn = { type: "run"; audio: Float32Array; model: ModelSize; language: string };
export type WorkerOut =
  | { type: "status"; stage: "model" | "listening"; fraction: number | null }
  | { type: "done"; words: CaptionWord[] }
  | { type: "error"; message: string };
