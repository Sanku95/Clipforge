import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatTime, parseTime } from "./time";

describe("parseTime", () => {
  it("parses plain seconds", () => {
    expect(parseTime("90")).toBe(90);
    expect(parseTime("90.5")).toBe(90.5);
  });
  it("parses m:ss and h:mm:ss", () => {
    expect(parseTime("1:30")).toBe(90);
    expect(parseTime("1:30.250")).toBeCloseTo(90.25);
    expect(parseTime("1:02:03.5")).toBeCloseTo(3723.5);
  });
  it("rejects bad input", () => {
    for (const bad of ["", "abc", "1:75", "1:2:3:4", "-5", "1:-5", "1.5:30", "0:60"]) {
      expect(parseTime(bad), bad).toBeNull();
    }
  });
});

describe("formatTime", () => {
  it("formats with milliseconds", () => {
    expect(formatTime(0)).toBe("0:00.000");
    expect(formatTime(90.25)).toBe("1:30.250");
    expect(formatTime(3723.5)).toBe("1:02:03.500");
  });
  it("round-trips through parseTime", () => {
    for (const v of [0, 1.5, 59.999, 61.001, 3599.5, 7322.125]) {
      expect(parseTime(formatTime(v))).toBeCloseTo(v, 3);
    }
  });
  it("is safe for bad numbers", () => {
    expect(formatTime(NaN)).toBe("0:00.000");
    expect(formatTime(-3)).toBe("0:00.000");
  });
});

describe("labels", () => {
  it("formats durations", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 05s");
    expect(formatDuration(3720)).toBe("1h 02m");
  });
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
