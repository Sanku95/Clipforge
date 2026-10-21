/**
 * Captions: data model, decorative style presets, ASS (libass) generation for burn-in, SRT, word grouping.
 * Pure functions only (no DOM / ffmpeg) so everything here is unit-tested.
 */
import type { Preset } from "./types";

export interface CaptionWord { t: string; s: number; e: number }
/** Times are seconds on the SOURCE video's timeline. */
export interface CaptionLine { id: string; start: number; end: number; text: string; words?: CaptionWord[] }

export type CaptionPresetId = "classic" | "pop" | "karaoke" | "neon" | "boxed" | "comic";
export type CaptionPosition = "top" | "middle" | "bottom";
export interface CaptionStyle {
  preset: CaptionPresetId;
  /** Percent of the base size (60..160). */
  size: number;
  position: CaptionPosition;
  uppercase: boolean;
  /** Accent colour as #RRGGBB: fill for Pop, highlight for Karaoke, glow for Neon, shadow for Comic. */
  accent: string;
}

export type FontKey = "poppins" | "anton" | "bangers" | "devanagari";
export const FONT_FAMILY: Record<FontKey, string> = {
  poppins: "Poppins ExtraBold",
  anton: "Anton",
  bangers: "Bangers",
  devanagari: "Noto Sans Devanagari ExtraBold"
};

/**
 * libass (like Windows GDI) treats "font size" as the whole line height (winAscent+winDescent), while CSS
 * font-size is the em. These ratios come from each bundled font's OS/2 table so that export size == preview size.
 */
export const FONT_CELL: Record<FontKey, number> = { poppins: 1.762, anton: 1.7334, bangers: 1.757, devanagari: 1.906 };

export interface PresetDef {
  id: CaptionPresetId;
  label: string;
  hint: string;
  font: FontKey;
  defaultAccent: string;
  defaultUppercase: boolean;
}
export const CAPTION_PRESETS: PresetDef[] = [
  { id: "classic", label: "Classic", hint: "Clean white, dark outline", font: "poppins", defaultAccent: "#FFFFFF", defaultUppercase: false },
  { id: "pop", label: "Bold Pop", hint: "Big colour caps, pops in", font: "anton", defaultAccent: "#FFD400", defaultUppercase: true },
  { id: "karaoke", label: "Karaoke", hint: "Words light up as spoken", font: "poppins", defaultAccent: "#FFD400", defaultUppercase: false },
  { id: "neon", label: "Neon Glow", hint: "Glowing outline", font: "poppins", defaultAccent: "#00E5FF", defaultUppercase: false },
  { id: "boxed", label: "Boxed", hint: "Text on a dark box", font: "poppins", defaultAccent: "#000000", defaultUppercase: false },
  { id: "comic", label: "Comic", hint: "Sticker look, offset shadow", font: "bangers", defaultAccent: "#FF3D81", defaultUppercase: true }
];
export const presetDef = (id: CaptionPresetId): PresetDef => CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];

export function defaultStyle(preset: CaptionPresetId = "pop"): CaptionStyle {
  const d = presetDef(preset);
  return { preset, size: 100, position: "bottom", uppercase: d.defaultUppercase, accent: d.defaultAccent };
}
export function applyPreset(style: CaptionStyle, preset: CaptionPresetId): CaptionStyle {
  const d = presetDef(preset);
  return { ...style, preset, accent: d.defaultAccent, uppercase: d.defaultUppercase };
}

const DEVANAGARI = /[ऀ-ॿ]/;
export const hasDevanagari = (s: string) => DEVANAGARI.test(s);
/** The decorative Latin fonts have no Devanagari glyphs; use Noto for those lines. */
export function fontFor(preset: CaptionPresetId, text: string): FontKey {
  return hasDevanagari(text) ? "devanagari" : presetDef(preset).font;
}

// ---------- geometry ----------
const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
/** Size of the exported frame; mirrors the FFmpeg crop filter in wasm.ts. */
export function outputSize(preset: Preset, srcW: number, srcH: number): { width: number; height: number } {
  if (preset === "original") return { width: even(srcW), height: even(srcH) };
  const r = preset === "vertical" ? 9 / 16 : preset === "square" ? 1 : 16 / 9;
  const width = even(Math.min(srcW, srcH * r));
  const height = even(Math.min(srcH, srcW / r));
  return { width, height };
}
/** Base font size in output pixels (ASS PlayRes units) before the user's size multiplier. */
export const baseFontSize = (w: number, h: number) => Math.min(w, h) * 0.075;
export function fontSizePx(style: CaptionStyle, w: number, h: number) {
  return baseFontSize(w, h) * (Math.max(40, Math.min(200, style.size)) / 100);
}
export function marginV(position: CaptionPosition, w: number, h: number) {
  if (position === "middle") return 0;
  // Leave room for Shorts/Reels buttons and captions on tall frames.
  return h > w ? h * 0.12 : h * 0.07;
}

// ---------- text helpers ----------
export function displayText(text: string, style: CaptionStyle): string {
  return style.uppercase ? text.toLocaleUpperCase() : text;
}
const escAss = (s: string) => s.replace(/\\/g, "/").replace(/[{}]/g, (c) => (c === "{" ? "(" : ")")).replace(/\r?\n/g, "\\N");

function assColor(hex: string, alpha = 0): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const h = m ? m[1] : "FFFFFF";
  const rr = h.slice(0, 2), gg = h.slice(2, 4), bb = h.slice(4, 6);
  return `&H${alpha.toString(16).toUpperCase().padStart(2, "0")}${bb}${gg}${rr}`.toUpperCase();
}
function assTime(t: number): string {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// ---------- clipping lines to a clip range ----------
export function linesForClip(lines: CaptionLine[], clipStart: number, clipEnd: number): CaptionLine[] {
  const out: CaptionLine[] = [];
  for (const l of lines) {
    if (l.end <= clipStart || l.start >= clipEnd || !l.text.trim()) continue;
    const s = Math.max(l.start, clipStart) - clipStart;
    const e = Math.min(l.end, clipEnd) - clipStart;
    if (e - s < 0.05) continue;
    const words = l.words
      ?.filter((w) => w.e > clipStart && w.s < clipEnd)
      .map((w) => ({ t: w.t, s: Math.max(w.s, clipStart) - clipStart, e: Math.min(w.e, clipEnd) - clipStart }));
    out.push({ ...l, start: s, end: e, words: words && words.length ? words : undefined });
  }
  return out;
}

// ---------- ASS ----------
interface StyleParams {
  primary: string; secondary: string; outline: string; back: string;
  bold: number; borderStyle: number; outlineW: number; shadow: number;
}
function styleParams(style: CaptionStyle, fs: number): StyleParams {
  const acc = style.accent;
  switch (style.preset) {
    case "pop":
      return { primary: assColor(acc), secondary: assColor(acc), outline: assColor("#000000"), back: assColor("#000000", 0x60), bold: 0, borderStyle: 1, outlineW: fs * 0.11, shadow: fs * 0.05 };
    case "karaoke":
      // Secondary = before the word is spoken, Primary = after.
      return { primary: assColor(acc), secondary: assColor("#FFFFFF"), outline: assColor("#000000"), back: assColor("#000000", 0x80), bold: 0, borderStyle: 1, outlineW: fs * 0.09, shadow: 0 };
    case "neon":
      return { primary: assColor("#FFFFFF"), secondary: assColor("#FFFFFF"), outline: assColor(acc), back: assColor("#000000", 0xFF), bold: 0, borderStyle: 1, outlineW: fs * 0.07, shadow: 0 };
    case "boxed":
      // BorderStyle 3 draws an opaque box using OutlineColour; Outline is the box padding.
      return { primary: assColor("#FFFFFF"), secondary: assColor("#FFFFFF"), outline: assColor(acc, 0x40), back: assColor("#000000", 0xFF), bold: 0, borderStyle: 3, outlineW: fs * 0.22, shadow: 0 };
    case "comic":
      return { primary: assColor("#FFFFFF"), secondary: assColor("#FFFFFF"), outline: assColor("#000000"), back: assColor(acc), bold: 0, borderStyle: 1, outlineW: fs * 0.13, shadow: fs * 0.08 };
    default:
      return { primary: assColor("#FFFFFF"), secondary: assColor("#FFFFFF"), outline: assColor("#000000"), back: assColor("#000000", 0x80), bold: 0, borderStyle: 1, outlineW: fs * 0.08, shadow: 0 };
  }
}
const FONT_KEYS: FontKey[] = ["poppins", "anton", "bangers", "devanagari"];
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Build an .ass file for one clip. `lines` must already be relative to the clip (see linesForClip). */
export function buildAss(lines: CaptionLine[], style: CaptionStyle, width: number, height: number): string {
  const fs = fontSizePx(style, width, height);
  const sp = styleParams(style, fs);
  const align = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const mv = Math.round(marginV(style.position, width, height));
  const mlr = Math.round(width * 0.06);
  const out: string[] = [];
  out.push("[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "");
  out.push("[V4+ Styles]", "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding");
  for (const k of FONT_KEYS) {
    out.push(`Style: ${k},${FONT_FAMILY[k]},${fmt(fs * FONT_CELL[k])},${sp.primary},${sp.secondary},${sp.outline},${sp.back},${sp.bold},0,0,0,100,100,0,0,${sp.borderStyle},${fmt(sp.outlineW)},${fmt(sp.shadow)},${align},${mlr},${mlr},${mv},1`);
  }
  out.push("", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text");
  for (const l of lines) {
    const text = displayText(l.text, style);
    const font = fontFor(style.preset, text);
    const pop = style.preset === "pop" || style.preset === "comic" ? "{\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)}" : "";
    const tilt = style.preset === "comic" ? "{\\frz-2}" : "";
    const glow = style.preset === "neon" ? "{\\blur5}" : "";
    let body: string;
    if (style.preset === "karaoke") body = karaokeText(l, style);
    else body = escAss(text);
    out.push(`Dialogue: 0,${assTime(l.start)},${assTime(l.end)},${font},,0,0,0,,${tilt}${glow}${pop}${body}`);
  }
  return out.join("\n") + "\n";
}

/** Words with timings for a line: the real ones when known, otherwise spread evenly over the line. */
export function lineWords(l: CaptionLine): CaptionWord[] {
  if (l.words && l.words.length) return l.words;
  const parts = l.text.trim().split(/\s+/).filter(Boolean);
  const per = (l.end - l.start) / Math.max(1, parts.length);
  return parts.map((t, i) => ({ t, s: l.start + i * per, e: l.start + (i + 1) * per }));
}

function karaokeText(l: CaptionLine, style: CaptionStyle): string {
  const words = lineWords(l);
  let cursor = l.start;
  const bits: string[] = [];
  for (const w of words) {
    const lead = Math.max(0, w.s - cursor); // silence before the word
    const dur = Math.max(0.02, w.e - Math.max(w.s, cursor));
    const t = escAss(displayText(w.t, style));
    if (lead > 0.01) bits.push(`{\\k${Math.round(lead * 100)}}`);
    bits.push(`{\\kf${Math.round(dur * 100)}}${t} `);
    cursor = Math.max(w.e, cursor);
  }
  return bits.join("").trimEnd();
}

// ---------- SRT ----------
function srtTime(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}
export function toSrt(lines: CaptionLine[]): string {
  return lines
    .filter((l) => l.text.trim())
    .sort((a, b) => a.start - b.start)
    .map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text.trim()}\n`)
    .join("\n");
}

// ---------- grouping speech words into short caption lines ----------
export function groupWords(words: CaptionWord[], opts: { maxWords?: number; maxDuration?: number; gap?: number } = {}): CaptionLine[] {
  const maxWords = opts.maxWords ?? 4, maxDuration = opts.maxDuration ?? 3, gap = opts.gap ?? 0.6;
  const lines: CaptionLine[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    const text = cur.map((w) => w.t).join(" ").replace(/\s+([,.!?;:।])/g, "$1").trim();
    lines.push({ id: `c${lines.length + 1}-${Math.round(cur[0].s * 1000)}`, start: cur[0].s, end: Math.max(cur[cur.length - 1].e, cur[0].s + 0.2), text, words: cur });
    cur = [];
  };
  for (const w of words) {
    if (!w.t.trim()) continue;
    const last = cur[cur.length - 1];
    if (last && (w.s - last.e > gap || cur.length >= maxWords || w.e - cur[0].s > maxDuration)) flush();
    cur.push({ ...w, t: w.t.trim() });
    if (/[.!?।]$/.test(w.t.trim())) flush();
  }
  flush();
  // Never let a caption overlap the next one.
  for (let i = 0; i < lines.length - 1; i++) lines[i].end = Math.min(lines[i].end, lines[i + 1].start);
  return lines;
}

// ---------- SRT import ----------
const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;
const toSec = (h: string, m: string, s: string, ms: string) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
/** Parse .srt text into caption lines (tolerates BOM, CRLF, missing index numbers, HTML-ish tags). */
export function parseSrt(input: string): CaptionLine[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const out: CaptionLine[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const rows = block.split("\n");
    const ti = rows.findIndex((r) => SRT_TIME.test(r));
    if (ti < 0) continue;
    const m = SRT_TIME.exec(rows[ti])!;
    const start = toSec(m[1], m[2], m[3], m[4]), end = toSec(m[5], m[6], m[7], m[8]);
    const body = rows.slice(ti + 1).join("\n").replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").trim();
    if (!body || !(end > start)) continue;
    out.push({ id: `s${out.length + 1}-${Math.round(start * 1000)}`, start, end, text: body.replace(/\n+/g, " ") });
  }
  return out.sort((a, b) => a.start - b.start);
}
