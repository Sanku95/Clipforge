import { describe, expect, it } from "vitest";
import { checkAccess, clientKey, makeLimiter, pickLanguage, pickLength, safeEqual } from "./_guard";

const env = { SSEMBLE_API_KEY: "key", CLIPFORGE_ACCESS_CODE: "correct-horse-battery" };

describe("checkAccess", () => {
  it("refuses when Ssemble is not configured", () => {
    expect(checkAccess({}, "x")).toMatchObject({ ok: false, status: 503 });
  });
  it("refuses when no (or a too-short) access code is configured, so the endpoint is never open", () => {
    expect(checkAccess({ SSEMBLE_API_KEY: "k" }, "anything")).toMatchObject({ ok: false, status: 503 });
    expect(checkAccess({ SSEMBLE_API_KEY: "k", CLIPFORGE_ACCESS_CODE: "short" }, "short")).toMatchObject({ ok: false, status: 503 });
  });
  it("rejects wrong, missing and non-string codes with 401", () => {
    for (const h of [undefined, "", "wrong", "correct-horse-battery-x", 5, ["nope"]]) {
      expect(checkAccess(env, h)).toMatchObject({ ok: false, status: 401 });
    }
  });
  it("accepts the right code (also as a header array)", () => {
    expect(checkAccess(env, "correct-horse-battery")).toEqual({ ok: true });
    expect(checkAccess(env, ["correct-horse-battery"])).toEqual({ ok: true });
  });
});

describe("safeEqual", () => {
  it("compares correctly and handles different lengths", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("allowlists", () => {
  it("passes documented values and falls back otherwise", () => {
    expect(pickLanguage("hi")).toBe("hi");
    expect(pickLanguage("xx")).toBe("en");
    expect(pickLanguage({ evil: 1 })).toBe("en");
    expect(pickLength("under3min")).toBe("under3min");
    expect(pickLength("under180sec")).toBe("under60sec");
    expect(pickLength(undefined)).toBe("under60sec");
  });
});

describe("makeLimiter", () => {
  it("allows up to max per window per key, then recovers", () => {
    let t = 0;
    const allow = makeLimiter(2, 1000, () => t);
    expect([allow("a"), allow("a"), allow("a")]).toEqual([true, true, false]);
    expect(allow("b")).toBe(true);
    t = 1500;
    expect(allow("a")).toBe(true);
  });
});

describe("clientKey", () => {
  it("uses the first forwarded address", () => {
    expect(clientKey({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })).toBe("1.2.3.4");
    expect(clientKey(undefined)).toBe("unknown");
  });
});
