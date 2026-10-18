/** Format seconds as m:ss.mmm (or h:mm:ss.mmm for long videos). */
export function formatTime(seconds: number, withMillis = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const base = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return withMillis ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

/** Short duration label such as "1h 02m" or "45s". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

/**
 * Parse "90", "90.5", "1:30", "1:30.250" or "1:02:03.5" into seconds.
 * Returns null if the text is not a valid time.
 */
export function parseTime(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const isLast = i === parts.length - 1;
    if (!(isLast ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p)) return null;
    const v = Number(p);
    if (!isLast && i > 0 && v >= 60) return null;
    total = total * 60 + v;
  }
  if (parts.length > 1 && Number(parts[parts.length - 1]) >= 60) return null;
  return Number.isFinite(total) ? total : null;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
