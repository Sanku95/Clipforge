import { describe, expect, it } from "vitest";
import { cropFilter, parseProbe, safeName } from "./wasm";

const LOG = `Input #0, matroska,webm, from '/in1/a.mkv':
  Duration: 00:03:00.02, start: 0.000000, bitrate: 15567 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps, 30 tbr, 1k tbn (default)
  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, mono, fltp (default)`;

describe("parseProbe", () => {
  it("reads duration, size, fps, codec and audio from ffmpeg's log", () => {
    expect(parseProbe(LOG)).toEqual({ duration: 180.02, width: 1920, height: 1080, fps: 30, hasAudio: true, videoCodec: "h264" });
  });
  it("detects missing audio", () => {
    expect(parseProbe(LOG.split("\n").slice(0, 3).join("\n"))?.hasAudio).toBe(false);
  });
  it("returns null when there is no video stream", () => {
    expect(parseProbe("Duration: 00:00:01.00\n  Stream #0:0: Audio: aac")).toBeNull();
  });
});

describe("cropFilter", () => {
  it("builds an even-sized 9:16 crop positioned by pan", () => {
    const f = cropFilter("vertical", 0.5);
    expect(f).toContain("crop=w=trunc(min(iw\\,ih*9/16)/2)*2");
    expect(f).toContain("x=(iw-ow)*0.5000");
  });
  it("clamps pan to 0..1", () => {
    expect(cropFilter("square", 5)).toContain("*1.0000");
    expect(cropFilter("square", -1)).toContain("*0.0000");
  });
  it("keeps the original framing but forces even dimensions", () => {
    expect(cropFilter("original", 0.5)).toBe("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  });
});

describe("safeName", () => {
  it("makes clip names filesystem-safe", () => {
    expect(safeName("My clip: #1!")).toBe("My-clip-1");
    expect(safeName("???")).toBe("clip");
  });
});
