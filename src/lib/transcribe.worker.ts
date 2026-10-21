/// <reference lib="webworker" />
/** Runs Whisper (transformers.js + onnxruntime-web, WASM) off the main thread. */
import { env, pipeline } from "@huggingface/transformers";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { MODEL_IDS, downloadFraction, ownedWords, planSlices, tidyWords, wordsFromChunks, type AsrChunk, type ModelSize, type WorkerIn, type WorkerOut } from "./transcribe-core";

const send = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);

// Only the model weights come from huggingface.co; the runtime ships with this site.
env.allowLocalModels = false;
env.useBrowserCache = true;
const ort = env.backends.onnx as unknown as { wasm?: { wasmPaths?: unknown; numThreads?: number } };
if (ort.wasm) {
  ort.wasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm };
  ort.wasm.numThreads = 1; // no cross-origin isolation on static hosting, so threads are unavailable
}

type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ chunks?: AsrChunk[] }>;
const cache = new Map<ModelSize, Promise<Transcriber>>();

function load(size: ModelSize): Promise<Transcriber> {
  let p = cache.get(size);
  if (!p) {
    const files = new Map<string, { loaded: number; total: number }>();
    p = (pipeline("automatic-speech-recognition", MODEL_IDS[size], {
      device: "wasm",
      dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
      progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
        if (e.status === "progress" && e.file && e.total) {
          files.set(e.file, { loaded: e.loaded ?? 0, total: e.total });
          send({ type: "status", stage: "model", fraction: downloadFraction(files) });
        }
      }
    }) as unknown) as Promise<Transcriber>;
    p.catch(() => cache.delete(size));
    cache.set(size, p);
  }
  return p;
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type !== "run") return;
  try {
    send({ type: "status", stage: "model", fraction: null });
    const asr = await load(msg.model);
    const rate = 16000;
    const total = msg.audio.length / rate;
    const slices = planSlices(total);
    const words = [];
    for (let i = 0; i < slices.length; i++) {
      send({ type: "status", stage: "listening", fraction: i / slices.length });
      const s = slices[i];
      const part = msg.audio.slice(Math.floor(s.start * rate), Math.floor(s.end * rate));
      const opts: Record<string, unknown> = { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, task: "transcribe" };
      if (msg.language && msg.language !== "auto") opts.language = msg.language;
      const out = await asr(part, opts);
      words.push(...ownedWords(wordsFromChunks(out.chunks, s.start), s));
    }
    send({ type: "status", stage: "listening", fraction: 1 });
    send({ type: "done", words: tidyWords(words) });
  } catch (e) {
    send({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
