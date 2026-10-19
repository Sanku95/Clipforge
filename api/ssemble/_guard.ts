/**
 * Shared checks for the Ssemble proxy endpoints. Files starting with "_" are not deployed as routes.
 * Pure functions (no network, no process state besides the rate-limit map) so they are unit-tested.
 */
import { timingSafeEqual } from "node:crypto";

// Values from Ssemble's documented create-short parameters (https://www.ssemble.com/docs/endpoints/create-short).
export const LANGUAGES = ["en","af","sq","ar","hy","az","bs","bg","ca","zh","hr","cs","da","nl","et","fo","tl","fi","fr","gl","ka","de","el","he","hi","hu","is","id","it","ja","ko","lv","lt","mk","ms","mt","mr","ne","no","fa","pl","pt","ro","ru","sr","sk","sl","es","sw","sv","tr","uk","ur","vi"] as const;
export const LENGTHS = ["under30sec", "under60sec", "under90sec", "under3min", "under5min", "under10min"] as const;

/** Constant-time string comparison (different lengths are simply unequal). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type Gate = { ok: true } | { ok: false; status: number; error: string };

/**
 * The endpoints spend paid Ssemble credits, so they must not be open to the internet:
 * an access code (env CLIPFORGE_ACCESS_CODE) is required, sent in the x-access-code header.
 */
export function checkAccess(env: Record<string, string | undefined>, header: unknown): Gate {
  if (!env.SSEMBLE_API_KEY) return { ok: false, status: 503, error: "Ssemble is not configured yet. Add the SSEMBLE_API_KEY environment variable in Vercel." };
  const code = env.CLIPFORGE_ACCESS_CODE;
  if (!code || code.length < 8) return { ok: false, status: 503, error: "Set CLIPFORGE_ACCESS_CODE (at least 8 characters) in Vercel so only you can start AI clipping." };
  const given = Array.isArray(header) ? header[0] : header;
  if (typeof given !== "string" || !safeEqual(given, code)) return { ok: false, status: 401, error: "Wrong or missing access code." };
  return { ok: true };
}

export function pickLanguage(v: unknown): (typeof LANGUAGES)[number] {
  return (LANGUAGES as readonly unknown[]).includes(v) ? (v as (typeof LANGUAGES)[number]) : "en";
}
export function pickLength(v: unknown): (typeof LENGTHS)[number] {
  return (LENGTHS as readonly unknown[]).includes(v) ? (v as (typeof LENGTHS)[number]) : "under60sec";
}

/** Best-effort per-instance limiter (serverless instances don't share memory, so this is a safety net, not a quota). */
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 500) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
    return true;
  };
}

export function clientKey(headers: Record<string, unknown> | undefined): string {
  const fwd = headers?.["x-forwarded-for"];
  const s = Array.isArray(fwd) ? fwd[0] : fwd;
  return typeof s === "string" ? s.split(",")[0].trim() : "unknown";
}
