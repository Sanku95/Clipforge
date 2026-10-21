import { groupWords, type CaptionLine } from "./captions";
import type { TranscribeOptions, TranscribeStatus } from "./api";
import type { WorkerIn, WorkerOut } from "./transcribe-core";
import { extractAudio } from "./wasm";

/** Detect speech in [start, end] of `file` on this device and return caption lines on the SOURCE timeline. */
export async function transcribeFile(
  file: File, start: number, end: number, opts: TranscribeOptions, onStatus: (s: TranscribeStatus) => void
): Promise<CaptionLine[]> {
  onStatus({ stage: "audio", fraction: null });
  const audio = await extractAudio(file, start, end, (f) => onStatus({ stage: "audio", fraction: f }));
  const worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
  try {
    const words = await new Promise<Extract<WorkerOut, { type: "done" }>["words"]>((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        const m = ev.data;
        if (m.type === "status") onStatus({ stage: m.stage, fraction: m.fraction });
        else if (m.type === "done") resolve(m.words);
        else reject(new Error(friendly(m.message)));
      };
      worker.onerror = (ev) => reject(new Error(friendly(ev.message || "The speech engine stopped unexpectedly.")));
      const msg: WorkerIn = { type: "run", audio, model: opts.model, language: opts.language };
      worker.postMessage(msg, [audio.buffer]);
    });
    const shifted = words.map((w) => ({ ...w, s: w.s + start, e: w.e + start }));
    const stamp = Date.now().toString(36);
    return groupWords(shifted).map((l, i) => ({ ...l, id: `t${stamp}-${i}` }));
  } finally {
    worker.terminate();
  }
}

function friendly(raw: string): string {
  if (/fetch|network|Failed to load|huggingface/i.test(raw)) {
    return "Could not download the speech model. Check your internet connection (the first run needs about 40–80 MB from huggingface.co) and try again.";
  }
  if (/memory|allocation|out of/i.test(raw)) return "The device ran out of memory. Try the Fast model or a shorter range.";
  return raw.length > 220 ? raw.slice(0, 220) + "…" : raw;
}
