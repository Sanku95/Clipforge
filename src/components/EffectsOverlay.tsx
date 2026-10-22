import { fadeLength, PROGRESS_COLOR, type EffectsSettings } from "../lib/effects";

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

interface Props {
  effects: EffectsSettings;
  /** Playhead and the selected range, in source seconds. */
  time: number;
  range: { start: number; end: number };
}

/** Preview-only layers for the vignette, grain, fades and progress bar. The export draws the real thing with ffmpeg. */
export function EffectsOverlay({ effects, time, range }: Props) {
  const dur = Math.max(0.001, range.end - range.start);
  const t = Math.min(dur, Math.max(0, time - range.start));
  const fl = effects.fade ? fadeLength(dur) : 0;
  const black = fl > 0 ? Math.max(0, 1 - t / fl, 1 - (dur - t) / fl) : 0;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="effects-overlay">
      {effects.vignette && <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,0.62) 100%)" }} />}
      {effects.grain && <div className="absolute inset-0" style={{ backgroundImage: GRAIN, opacity: 0.22, mixBlendMode: "overlay" }} />}
      {effects.progress && (
        <div className="absolute bottom-0 left-0" style={{ height: "0.8%", minHeight: 3, width: `${(t / dur) * 100}%`, background: `#${PROGRESS_COLOR}` }} />
      )}
      {black > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: Math.min(1, black) }} />}
    </div>
  );
}
