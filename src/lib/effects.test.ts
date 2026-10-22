import { describe, expect, it } from "vitest";
import { defaultEffects, fadeLength, hasEffects, LOOKS, videoGraphArgs } from "./effects";

const base = { crop: "crop=100:200", dur: 10, outW: 100, outH: 200 };
const on = (patch: object) => ({ ...defaultEffects(), ...patch });

describe("videoGraphArgs", () => {
  it("matches the plain pipeline when there are no effects", () => {
    expect(videoGraphArgs(base)).toEqual(["-vf", "crop=100:200,format=yuv420p"]);
    expect(videoGraphArgs({ ...base, subtitles: "subtitles=filename=a.ass", effects: defaultEffects() })).toEqual(["-vf", "crop=100:200,subtitles=filename=a.ass,format=yuv420p"]);
  });
  it("puts the colour work before captions and the fade after them", () => {
    const [flag, vf] = videoGraphArgs({ ...base, subtitles: "subtitles=x", effects: on({ look: "mono", vignette: true, grain: true, fade: true }) });
    expect(flag).toBe("-vf");
    const order = ["crop=", "hue=s=0", "vignette", "noise", "subtitles", "fade=t=in", "fade=t=out", "format=yuv420p"].map((k) => vf.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("adds an audio fade that matches the video fade", () => {
    const args = videoGraphArgs({ ...base, effects: on({ fade: true }) });
    expect(args.join(" ")).toContain("fade=t=out:st=9.500:d=0.500");
    expect(args[args.indexOf("-af") + 1]).toBe("afade=t=in:st=0:d=0.500,afade=t=out:st=9.500:d=0.500");
  });
  it("skips fades on very short clips", () => {
    expect(fadeLength(1.5)).toBe(0);
    expect(videoGraphArgs({ ...base, dur: 1.5, effects: on({ fade: true }) })).not.toContain("-af");
  });
  it("uses a filter graph with an overlaid bar for the progress bar", () => {
    const a = videoGraphArgs({ ...base, effects: on({ progress: true, fade: true }) });
    expect(a.slice(0, 1)).toEqual(["-filter_complex"]);
    expect(a[1]).toMatch(/^\[0:v:0\]crop=100:200\[b\];color=c=0xff6a2b:s=100x6:r=30:d=10\.000\[bar\];\[b\]\[bar\]overlay=x='-w\+w\*t\/10\.000':y=H-h:eof_action=pass,fade=.*format=yuv420p\[v\]$/);
    expect(a).toContain("[v]");
    expect(a).toContain("0:a?");
  });
  it("has a valid filter list for every look", () => {
    for (const l of LOOKS) expect(l.ff.every((f) => /^[a-z]+=/.test(f))).toBe(true);
    expect(hasEffects(defaultEffects())).toBe(false);
    expect(hasEffects(on({ grain: true }))).toBe(true);
  });
});
