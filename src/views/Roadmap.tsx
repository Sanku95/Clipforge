import { Badge, Panel } from "../components/ui";

type Item = { title: string; status: "Available" | "Planned"; body: string };

const ITEMS: Item[] = [
  { title: "Import, preview and trim", status: "Available", body: "Import local videos, preview them, set precise in/out points and cut multiple clips from one source." },
  { title: "Social export presets", status: "Available", body: "9:16, 1:1, 16:9 or original framing, with an adjustable fixed crop. Exports are re-encoded with the bundled FFmpeg and verified." },
  { title: "Local transcription", status: "Planned", body: "Speech-to-text running on your Mac with a Whisper model. It will need a one-time model download (roughly 150 MB to 1.5 GB depending on the size you pick). Not included yet." },
  { title: "AI highlight suggestions", status: "Planned", body: "Rank transcript moments (strong statements, questions, topic changes) and propose clip ranges you can adjust. This depends on transcription, so it comes after it. Not included yet." },
  { title: "Captions", status: "Planned", body: "Editable captions with font size and placement, burned in or exported as .srt. Not included yet." },
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
        ClipForge processes videos on this Mac only. It has no accounts, no analytics and no network features. Project data is a small
        JSON file in the app's data folder.
      </Panel>
    </div>
  );
}
