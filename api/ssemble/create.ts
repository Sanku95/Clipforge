type ApiRequest = { method?: string; body?: { url?: unknown; start?: unknown; end?: unknown; maxShorts?: unknown; language?: unknown; preferredLength?: unknown } };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const apiKey = process.env.SSEMBLE_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "Ssemble is not configured yet. Add the SSEMBLE_API_KEY environment variable in Vercel." });
  const { url, start, end, maxShorts, language, preferredLength } = req.body ?? {};
  if (typeof url !== "string") return res.status(400).json({ error: "Paste a YouTube video URL." });
  let parsed: URL;
  try { parsed = new URL(url); } catch { return res.status(400).json({ error: "Enter a valid YouTube URL." }); }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host) || parsed.protocol !== "https:") {
    return res.status(400).json({ error: "Use a standard HTTPS YouTube video URL." });
  }
  if (parsed.pathname.startsWith("/shorts/")) return res.status(400).json({ error: "Ssemble's API does not support YouTube Shorts links yet. Use a standard YouTube video URL." });
  const startSeconds = Number(start ?? 0), endSeconds = Number(end ?? 600);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds < 60 || endSeconds - startSeconds > 1200) {
    return res.status(400).json({ error: "Choose a time range between 1 and 20 minutes." });
  }
  const count = Number(maxShorts ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > 12) return res.status(400).json({ error: "Number of clips must be between 1 and 12." });
  try {
    const upstream = await fetch("https://aiclipping.ssemble.com/api/v1/shorts/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ url: parsed.toString(), start: startSeconds, end: endSeconds, maxShorts: count, language: typeof language === "string" ? language : "en", preferredLength: typeof preferredLength === "string" ? preferredLength : "under60sec" })
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error?.message ?? data?.message ?? "Ssemble could not start this request.", details: data?.error?.code });
    return res.status(200).json(data);
  } catch {
    return res.status(502).json({ error: "Could not reach Ssemble. Please try again." });
  }
}
