import { Badge, Panel } from "../components/ui";

type Item = { title: string; status: "Available" | "Planned"; body: string };

const ITEMS: Item[] = [
  { title: "Import, preview and trim", status: "Available", body: "Import local videos, preview them, set precise in/out points and cut multiple clips from one source." },
  { title: "Social export presets", status: "Available", body: "9:16, 1:1, 16:9 or original framing, with an adjustable fixed crop. Exports are re-encoded with FFmpeg (bundled in the Mac app; running as WebAssembly on the website) and verified. Websites export MP4 and read MKV/AVI too." },
  { title: "Captions", status: "Available", body: "Website version: detect speech on your device (Whisper), edit the lines, pick a decorative style, preview it live and burn it into exported MP4s, or download an .srt. New: check the lines for mistakes, especially names, numbers and non-English speech. The first run downloads a 40–80 MB speech model from huggingface.co." },
  { title: "AI highlight suggestions", status: "Planned", body: "Rank transcript moments (strong statements, questions, topic changes) and propose clip ranges you can adjust. This depends on transcription, so it comes after it. Not included yet." },
  { title: "Face-aware framing", status: "Planned", body: "Today's vertical crop is a fixed position you choose. Automatic subject tracking is not implemented." }
];

export function Roadmap() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Roadmap</h1>
        <p className="mt-1 text-sm text-mute">What works today, and what is still planned. Nothing marked “Planned” is simulated in the app.</p>
      </div>
      <ul className="space-y-3">
        {ITEMS.map((i) => (
          <li key={i.title}>
            <Panel className="p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-medium">{i.title}</h2>
                <Badge tone={i.status === "Available" ? "ok" : "warn"}>{i.status}</Badge>
              </div>
              <p className="mt-1.5 text-[13px] text-mute">{i.body}</p>
            </Panel>
          </li>
        ))}
      </ul>
      <Panel className="p-4 text-[13px] text-mute">
        <h2 className="mb-1 text-[14px] font-medium text-ink">Privacy</h2>
        ClipForge edits videos on this device only. It has no accounts and no analytics, and your video files are never uploaded. On the website, project
        data is stored in your browser; in the Mac app it is a small JSON file in the app's data folder.
      </Panel>
    </div>
  );
}
