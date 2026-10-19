import { describe, expect, it } from "vitest";
import {
  CAPTION_PRESETS, applyPreset, buildAss, defaultStyle, fontFor, groupWords, linesForClip, outputSize, toSrt,
  type CaptionLine, type CaptionWord
} from "./captions";

const words = (spec: [string, number, number][]): CaptionWord[] => spec.map(([t, s, e]) => ({ t, s, e }));

describe("outputSize (mirrors the ffmpeg crop filter)", () => {
  it("9:16 from 1080p landscape", () => expect(outputSize("vertical", 1920, 1080)).toEqual({ width: 606, height: 1080 }));
  it("1:1 from 1080p", () => expect(outputSize("square", 1920, 1080)).toEqual({ width: 1080, height: 1080 }));
  it("16:9 from a vertical source fits the width", () => expect(outputSize("landscape", 1080, 1920)).toEqual({ width: 1080, height: 606 }));
  it("original keeps size, forced even", () => expect(outputSize("original", 1281, 721)).toEqual({ width: 1280, height: 720 }));
});

describe("linesForClip", () => {
  const lines: CaptionLine[] = [
    { id: "a", start: 1, end: 3, text: "before and across", words: words([["before", 1, 1.5], ["and", 1.5, 2], ["across", 2, 3]]) },
    { id: "b", start: 5, end: 6, text: "inside" },
    { id: "c", start: 20, end: 21, text: "after" }
  ];
  it("keeps only overlapping lines, shifted to clip time and clipped", () => {
    const out = linesForClip(lines, 2, 10);
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
    expect(out[0].start).toBe(0);
    expect(out[0].end).toBe(1);
    expect(out[0].words?.map((w) => w.t)).toEqual(["across"]);
    expect(out[1].start).toBe(3);
  });
  it("drops blank and sliver lines", () => {
    expect(linesForClip([{ id: "x", start: 1, end: 2, text: "  " }], 0, 5)).toEqual([]);
    expect(linesForClip([{ id: "y", start: 1, end: 1.02, text: "hi" }], 0, 5)).toEqual([]);
  });
});

describe("buildAss", () => {
  const lines: CaptionLine[] = [{ id: "1", start: 0, end: 2, text: "Hello brave world", words: words([["Hello", 0, 0.5], ["brave", 0.6, 1.2], ["world", 1.2, 2]]) }];
  it("has valid header, PlayRes = output size, one style per font", () => {
    const ass = buildAss(lines, defaultStyle("classic"), 606, 1080);
    expect(ass).toContain("PlayResX: 606");
    expect(ass).toContain("PlayResY: 1080");
    expect((ass.match(/^Style: /gm) ?? []).length).toBe(4);
    expect(ass).toContain("Style: poppins,Poppins ExtraBold,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,poppins,,0,0,0,,Hello brave world");
  });
  it("converts #RRGGBB to ASS BGR", () => {
    const s = { ...defaultStyle("pop"), accent: "#112233" };
    expect(buildAss(lines, s, 606, 1080)).toContain("&H00332211");
  });
  it("uppercases and adds the pop-in animation for Bold Pop", () => {
    const ass = buildAss(lines, defaultStyle("pop"), 606, 1080);
    expect(ass).toContain("HELLO BRAVE WORLD");
    expect(ass).toContain("\\t(0,140,");
    expect(ass).toContain(",anton,,");
  });
  it("neon uses a blur glow; comic tilts; boxed uses BorderStyle 3", () => {
    expect(buildAss(lines, defaultStyle("neon"), 606, 1080)).toContain("{\\blur5}");
    expect(buildAss(lines, defaultStyle("comic"), 606, 1080)).toContain("{\\frz-2}");
    expect(buildAss(lines, defaultStyle("boxed"), 606, 1080)).toMatch(/Style: poppins,[^,]+,[\d.]+,[^,]+,[^,]+,[^,]+,[^,]+,0,0,0,0,100,100,0,0,3,/);
  });
  it("karaoke emits one timed tag per word that adds up to the line length", () => {
    const ass = buildAss(lines, defaultStyle("karaoke"), 606, 1080);
    const tags = [...ass.matchAll(/\\(k|kf)(\d+)\}/g)].map((m) => Number(m[2]));
    expect(ass.match(/\\kf/g)?.length).toBe(3);
    expect(tags.reduce((a, b) => a + b, 0)).toBe(200);
  });
  it("karaoke without word timings spreads words evenly", () => {
    const ass = buildAss([{ id: "2", start: 0, end: 3, text: "one two three" }], defaultStyle("karaoke"), 606, 1080);
    expect([...ass.matchAll(/\\kf(\d+)\}/g)].map((m) => Number(m[1]))).toEqual([100, 100, 100]);
  });
  it("positions: bottom=2, middle=5, top=8", () => {
    const a = (p: "top" | "middle" | "bottom") => buildAss(lines, { ...defaultStyle("classic"), position: p }, 606, 1080).match(/Style: poppins,.*/)![0].split(",")[18];
    expect([a("bottom"), a("middle"), a("top")]).toEqual(["2", "5", "8"]);
  });
  it("escapes override braces and newlines in text", () => {
    const ass = buildAss([{ id: "3", start: 0, end: 1, text: "a {b}\nc" }], defaultStyle("classic"), 606, 1080);
    expect(ass).toContain("a (b)\\Nc");
  });
  it("switches to the Devanagari font for Hindi text", () => {
    expect(fontFor("pop", "नमस्ते दुनिया")).toBe("devanagari");
    expect(fontFor("pop", "hello")).toBe("anton");
    expect(buildAss([{ id: "4", start: 0, end: 1, text: "नमस्ते" }], defaultStyle("pop"), 606, 1080)).toContain(",devanagari,,");
  });
  it("every preset produces a well-formed file", () => {
    for (const p of CAPTION_PRESETS) {
      const ass = buildAss(lines, defaultStyle(p.id), 1080, 1080);
      expect(ass).toContain("[Events]");
      expect(ass).toMatch(/Dialogue: 0,/);
    }
  });
  it("applyPreset resets accent and case to that preset's defaults", () => {
    const s = applyPreset({ ...defaultStyle("classic"), accent: "#123456" }, "pop");
    expect(s).toMatchObject({ preset: "pop", accent: "#FFD400", uppercase: true });
  });
});

describe("toSrt", () => {
  it("numbers, formats times and sorts", () => {
    const srt = toSrt([
      { id: "b", start: 3.5, end: 4, text: "second" },
      { id: "a", start: 0.25, end: 1.5, text: " first " }
    ]);
    expect(srt).toBe("1\n00:00:00,250 --> 00:00:01,500\nfirst\n\n2\n00:00:03,500 --> 00:00:04,000\nsecond\n");
  });
});

describe("groupWords", () => {
  it("splits at max words, sentence ends and long pauses; never overlaps", () => {
    const w = words([["I", 0, 0.2], ["think", 0.2, 0.5], ["this", 0.5, 0.8], ["is", 0.8, 1], ["great.", 1, 1.4], ["Next", 1.5, 1.8], ["topic", 5, 5.4]]);
    const lines = groupWords(w, { maxWords: 4 });
    expect(lines.map((l) => l.text)).toEqual(["I think this is", "great.", "Next", "topic"]);
    for (let i = 0; i < lines.length - 1; i++) expect(lines[i].end).toBeLessThanOrEqual(lines[i + 1].start);
  });
  it("ignores empty tokens and keeps punctuation tight", () => {
    const lines = groupWords(words([["Hello", 0, 0.4], [" ", 0.4, 0.5], [",", 0.5, 0.6], ["world", 0.6, 1]]));
    expect(lines[0].text).toBe("Hello, world");
  });
});
