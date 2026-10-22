/**
 * Decorative video effects: a colour "look" plus a few finishing touches.
 * The same settings drive the live preview (CSS) and the export (ffmpeg filters), so the two stay close.
 */

export type LookId = "none" | "vivid" | "warm" | "cinema" | "vintage" | "mono";

export interface EffectsSettings {
  look: LookId;
  vignette: boolean;
  grain: boolean;
  /** Fade in from black and out to black (video and audio). */
  fade: boolean;
  /** Thin progress bar along the bottom edge. */
  progress: boolean;
}

export interface LookDef {
  id: LookId;
  label: string;
  hint: string;
  /** ffmpeg filters applied right after the crop. */
  ff: string[];
  /** CSS filter for the live preview (an approximation of `ff`). */
  css: string;
}

export const LOOKS: LookDef[] = [
  { id: "none", label: "Original", hint: "No colour change", ff: [], css: "none" },
  { id: "vivid", label: "Vivid", hint: "Punchier colour and contrast", ff: ["eq=contrast=1.08:saturation=1.35:brightness=0.01"], css: "contrast(1.08) saturate(1.35) brightness(1.01)" },
  { id: "warm", label: "Golden", hint: "Warm, sunlit tones", ff: ["colorbalance=rs=.08:gs=.02:bs=-.08:rm=.06:bm=-.05:rh=.05:bh=-.06", "eq=saturation=1.12:contrast=1.05"], css: "sepia(0.2) saturate(1.2) contrast(1.05) hue-rotate(-6deg)" },
  { id: "cinema", label: "Cinema", hint: "Teal shadows, warm highlights", ff: ["colorbalance=rs=-.06:gs=-.01:bs=.08:rm=-.02:bm=.03:rh=.07:bh=-.05", "eq=contrast=1.15:brightness=-0.02:saturation=1.05"], css: "contrast(1.15) brightness(0.98) saturate(1.05) hue-rotate(4deg)" },
  { id: "vintage", label: "Retro", hint: "Faded, warm film", ff: ["eq=saturation=0.72:contrast=0.95:brightness=0.03", "colorbalance=rm=.07:gm=.02:bm=-.08"], css: "sepia(0.28) saturate(0.78) contrast(0.95) brightness(1.03)" },
  { id: "mono", label: "Mono", hint: "Black and white", ff: ["hue=s=0", "eq=contrast=1.15"], css: "grayscale(1) contrast(1.15)" }
];

export const defaultEffects = (): EffectsSettings => ({ look: "none", vignette: false, grain: false, fade: false, progress: false });

export const hasEffects = (e?: EffectsSettings | null): boolean => !!e && (e.look !== "none" || e.vignette || e.grain || e.fade || e.progress);

export const lookDef = (id: LookId): LookDef => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

export const PROGRESS_COLOR = "ff6a2b";
const FADE_SECONDS = 0.5;

/** Fade length for a clip; very short clips get none. */
export const fadeLength = (dur: number): number => (dur >= 2 ? Math.min(FADE_SECONDS, dur / 4) : 0);

/** Progress bar thickness in output pixels. */
export const barHeight = (outHeight: number): number => Math.max(6, Math.round(outHeight * 0.008));

const f3 = (n: number) => n.toFixed(3);

export interface GraphInput {
  /** The crop/scale filter for the chosen preset. */
  crop: string;
  /** Optional `subtitles=...` filter. */
  subtitles?: string;
  effects?: EffectsSettings;
  /** Clip length in seconds. */
  dur: number;
  outW: number;
  outH: number;
}

/**
 * ffmpeg arguments that build the video (and, for fades, audio) processing.
 * Order: crop, colour look, vignette, grain, captions, progress bar, fades. Captions sit under the fade and
 * the colour work never touches them.
 */
export function videoGraphArgs(g: GraphInput): string[] {
  const e = g.effects;
  const pre: string[] = [g.crop];
  if (e) {
    pre.push(...lookDef(e.look).ff);
    if (e.vignette) pre.push("vignette=angle=PI/5");
    if (e.grain) pre.push("noise=alls=14:allf=t+u");
  }
  if (g.subtitles) pre.push(g.subtitles);
  const fl = e?.fade ? fadeLength(g.dur) : 0;
  const post: string[] = [];
  if (fl > 0) post.push(`fade=t=in:st=0:d=${f3(fl)}`, `fade=t=out:st=${f3(g.dur - fl)}:d=${f3(fl)}`);
  post.push("format=yuv420p");
  const args: string[] = [];
  if (e?.progress) {
    const bh = barHeight(g.outH);
    const graph =
      `[0:v:0]${pre.join(",")}[b];` +
      `color=c=0x${PROGRESS_COLOR}:s=${g.outW}x${bh}:r=30:d=${f3(g.dur)}[bar];` +
      `[b][bar]overlay=x='-w+w*t/${f3(g.dur)}':y=H-h:eof_action=pass,${post.join(",")}[v]`;
    args.push("-filter_complex", graph, "-map", "[v]", "-map", "0:a?");
  } else {
    args.push("-vf", [...pre, ...post].join(","));
  }
  if (fl > 0) args.push("-af", `afade=t=in:st=0:d=${f3(fl)},afade=t=out:st=${f3(g.dur - fl)}:d=${f3(fl)}`);
  return args;
}
