import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { FONT_CELL, FONT_FAMILY, displayText, fontFor, fontSizePx, lineWords, marginV, outputSize, type CaptionLine, type CaptionStyle } from "../lib/captions";
import { fontFaceCss } from "../lib/fonts";
import type { Preset } from "../lib/types";

let faceInjected = false;
export function useCaptionFonts() {
  useEffect(() => {
    if (faceInjected) return;
    faceInjected = true;
    const el = document.createElement("style");
    el.textContent = fontFaceCss() + "\n@keyframes cf-pop{from{transform:scale(.82)}to{transform:scale(1)}}";
    document.head.appendChild(el);
  }, []);
}

/** CSS that approximates how the exported (libass) caption looks. `px` is the font size in on-screen pixels. */
export function captionCss(style: CaptionStyle, text: string, px: number): CSSProperties {
  const key = fontFor(style.preset, text);
  const family = FONT_FAMILY[key];
  // Line height matches the exporter (libass advances one font "cell" per line).
  const base: CSSProperties = { fontFamily: `"${family}", system-ui, sans-serif`, fontSize: px, lineHeight: FONT_CELL[key], textAlign: "center", paintOrder: "stroke fill", wordBreak: "break-word" };
  const acc = style.accent;
  switch (style.preset) {
    case "pop":
      return { ...base, color: acc, WebkitTextStroke: `${px * 0.2}px #000`, textShadow: `0 ${px * 0.05}px 0 rgba(0,0,0,.4)` };
    case "karaoke":
      return { ...base, color: "#fff", WebkitTextStroke: `${px * 0.17}px #000` };
    case "neon":
      return { ...base, color: "#fff", WebkitTextStroke: `${px * 0.06}px ${acc}`, textShadow: `0 0 ${px * 0.16}px ${acc}, 0 0 ${px * 0.4}px ${acc}` };
    case "boxed":
      return { ...base, color: "#fff", background: `${acc}ee`, padding: `${px * 0.12}px ${px * 0.35}px`, borderRadius: px * 0.12, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" };
    case "comic":
      return { ...base, color: "#fff", WebkitTextStroke: `${px * 0.24}px #000`, textShadow: `${px * 0.09}px ${px * 0.09}px 0 ${acc}`, transform: "rotate(-2deg)" };
    default:
      return { ...base, color: "#fff", WebkitTextStroke: `${px * 0.15}px #000` };
  }
}

export function CaptionText({ line, t, style, px }: { line: CaptionLine; t: number; style: CaptionStyle; px: number }) {
  const shown = displayText(line.text, style);
  const css = captionCss(style, shown, px);
  const animate = style.preset === "pop" || style.preset === "comic";
  if (style.preset === "karaoke") {
    return (
      <span style={{ ...css, display: "inline-block" }}>
        {lineWords(line).map((w, i) => (
          <span key={i} style={{ color: t >= w.s ? style.accent : "#fff" }}>{displayText(w.t, style)}{" "}</span>
        ))}
      </span>
    );
  }
  return (
    <span key={line.id} style={{ ...css, display: "inline-block", animation: animate ? "cf-pop .14s ease-out" : undefined }}>
      {shown}
    </span>
  );
}

interface Props {
  lines: CaptionLine[];
  style: CaptionStyle;
  /** Playhead on the source timeline, in seconds. */
  time: number;
  preset: Preset;
  srcWidth: number;
  srcHeight: number;
}

/** Draws the current caption over the framing preview, scaled so proportions match the export. */
export function CaptionOverlay({ lines, style, time, preset, srcWidth, srcHeight }: Props) {
  useCaptionFonts();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const out = useMemo(() => outputSize(preset, srcWidth, srcHeight), [preset, srcWidth, srcHeight]);
  const scale = w > 0 ? w / out.width : 0;
  const line = lines.find((l) => time >= l.start && time < l.end);
  const px = fontSizePx(style, out.width, out.height) * scale;
  const mv = marginV(style.position, out.width, out.height) * scale;
  const pos: CSSProperties =
    style.position === "top" ? { top: mv } : style.position === "middle" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: mv };
  return (
    <div ref={box} className="pointer-events-none absolute inset-0" data-testid="caption-overlay">
      {line && scale > 0 && (
        <div className="absolute flex justify-center" style={{ left: out.width * 0.06 * scale, right: out.width * 0.06 * scale, ...pos }}>
          <CaptionText line={line} t={time} style={style} px={px} />
        </div>
      )}
    </div>
  );
}
