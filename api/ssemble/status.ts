import { checkAccess } from "./_guard";
type ApiRequest = { method?: string; headers?: Record<string, unknown>; query?: { id?: string } };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const gate = checkAccess(process.env, req.headers?.["x-access-code"]);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  const apiKey = process.env.SSEMBLE_API_KEY as string;
  const id = req.query?.id;
  if (typeof id !== "string" || !/^[a-fA-F0-9]{24}$/.test(id)) return res.status(400).json({ error: "Invalid Ssemble request ID." });
  try {
    const headers = { "X-API-Key": apiKey };
    const statusResponse = await fetch(`https://aiclipping.ssemble.com/api/v1/shorts/${id}/status`, { headers });
    const statusData = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) return res.status(statusResponse.status).json({ error: statusData?.error?.message ?? "Could not check Ssemble status." });
    const status = statusData?.data?.status ?? statusData?.status;
    if (status === "completed") {
      const resultResponse = await fetch(`https://aiclipping.ssemble.com/api/v1/shorts/${id}`, { headers });
      const resultData = await resultResponse.json().catch(() => ({}));
      if (!resultResponse.ok) return res.status(resultResponse.status).json({ error: resultData?.error?.message ?? "Clips are ready, but their details could not be loaded." });
      return res.status(200).json({ status, progress: 100, result: resultData?.data ?? resultData });
    }
    return res.status(200).json({ status: status ?? "processing", progress: statusData?.data?.progress ?? statusData?.progress ?? null, message: statusData?.data?.message ?? statusData?.message ?? null });
  } catch {
    return res.status(502).json({ error: "Could not reach Ssemble to check progress." });
  }
}
