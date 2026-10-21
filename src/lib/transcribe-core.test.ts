import { describe, expect, it } from "vitest";
import { groupWords } from "./captions";
import { downloadFraction, ownedWords, planSlices, tidyWords, wordsFromChunks } from "./transcribe-core";

describe("planSlices", () => {
  it("one slice for short audio", () => expect(planSlices(90)).toEqual([{ start: 0, end: 90, keepFrom: 0, keepTo: 90 }]));
  it("nothing for empty audio", () => expect(planSlices(0)).toEqual([]));
  it("overlapping windows whose owned spans tile the audio with no gaps or overlaps", () => {
    for (const total of [121, 250, 600, 1234.5]) {
      const s = planSlices(total);
      expect(s[0].keepFrom).toBe(0);
      expect(s[s.length - 1].end).toBe(total);
      expect(s[s.length - 1].keepTo).toBe(total);
      for (let i = 0; i < s.length - 1; i++) {
        expect(s[i].keepTo).toBeCloseTo(s[i + 1].keepFrom, 9);
        expect(s[i].end).toBeGreaterThan(s[i + 1].start); // windows overlap
      }
      for (const x of s) expect(x.end - x.start).toBeLessThanOrEqual(120);
    }
  });
});

describe("wordsFromChunks", () => {
  it("offsets times, trims text, fixes a missing end, drops blanks and non-speech tags", () => {
    const w = wordsFromChunks(
      [
        { text: " Hello", timestamp: [0, 0.4] },
        { text: " world.", timestamp: [0.5, null] },
        { text: " ", timestamp: [1, 1.2] },
        { text: "[BLANK_AUDIO]", timestamp: [2, 3] },
        { text: "(music)", timestamp: [3, 4] },
        { text: "orphan", timestamp: [null, null] }
      ],
      10
    );
    expect(w).toEqual([{ t: "Hello", s: 10, e: 10.4 }, { t: "world.", s: 10.5, e: 10.85 }]);
  });
  it("repairs zero or negative lengths and handles undefined input", () => {
    expect(wordsFromChunks([{ text: "a", timestamp: [1, 1] }], 0)).toEqual([{ t: "a", s: 1, e: 1.35 }]);
    expect(wordsFromChunks(undefined, 0)).toEqual([]);
  });
  it("keeps Hindi words as they are", () => {
    expect(wordsFromChunks([{ text: " नमस्ते", timestamp: [0, 0.6] }], 0)[0].t).toBe("नमस्ते");
  });
});

describe("ownedWords + merging slices", () => {
  it("a word heard by two overlapping windows is kept exactly once", () => {
    const slices = planSlices(250);
    const everyWord = Array.from({ length: 250 }, (_, i) => ({ t: `w${i}`, s: i + 0.1, e: i + 0.6 }));
    const merged = slices.flatMap((s) => ownedWords(everyWord.filter((w) => w.e > s.start && w.s < s.end), s));
    expect(merged.map((w) => w.t)).toEqual(everyWord.map((w) => w.t));
  });
});

describe("tidyWords", () => {
  it("sorts and removes overlaps between neighbouring words", () => {
    const t = tidyWords([{ t: "b", s: 1.0, e: 1.5 }, { t: "a", s: 0.2, e: 1.2 }]);
    expect(t.map((w) => w.t)).toEqual(["a", "b"]);
    expect(t[0].e).toBeLessThanOrEqual(t[1].s + 1e-9);
    for (const w of t) expect(w.e).toBeGreaterThan(w.s);
  });
});

describe("downloadFraction", () => {
  it("sums loaded/total across files and is null before any file is known", () => {
    expect(downloadFraction(new Map())).toBeNull();
    expect(downloadFraction(new Map([["a", { loaded: 5, total: 10 }], ["b", { loaded: 15, total: 30 }]]))).toBe(0.5);
  });
});

describe("speech words -> caption lines (end to end of the pure pipeline)", () => {
  it("produces short, non-overlapping caption lines with word timings", () => {
    const chunks = ["So", "today", "we", "are", "going", "to", "talk", "about", "speech", "detection."].map((t, i) => ({ text: ` ${t}`, timestamp: [i * 0.4, i * 0.4 + 0.35] as [number, number] }));
    const lines = groupWords(tidyWords(wordsFromChunks(chunks, 100)));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].start).toBeCloseTo(100, 5);
    for (const l of lines) { expect(l.words?.length).toBeLessThanOrEqual(4); expect(l.end).toBeGreaterThan(l.start); }
    for (let i = 0; i < lines.length - 1; i++) expect(lines[i].end).toBeLessThanOrEqual(lines[i + 1].start);
    expect(lines.map((l) => l.text).join(" ")).toBe("So today we are going to talk about speech detection.");
  });
});
