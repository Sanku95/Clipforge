import { Trash2, Scissors } from "lucide-react";
import type { Clip } from "../lib/types";
import { formatDuration, formatTime } from "../lib/time";
import { Panel } from "./ui";

interface Props {
  clips: Clip[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (c: Clip) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

export function ClipList({ clips, selectedId, disabled, onSelect, onRename, onRemove }: Props) {
  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Clips</h3>
        <span className="text-xs text-mute">{clips.length} total</span>
      </div>
      {clips.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-line px-4 py-8 text-center">
          <Scissors className="mb-2 h-6 w-6 text-ember" aria-hidden />
          <p className="text-sm font-medium">No clips yet</p>
          <p className="mt-1 text-xs text-mute">Set an in and out point on the timeline, then choose “Add clip”.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {clips.map((c, i) => {
            const active = c.id === selectedId;
            return (
              <li
                key={c.id}
                className={`rounded-lg border p-2.5 ${active ? "border-ember bg-ember/10" : "border-line bg-raised"}`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-[11px] text-mute">{i + 1}</span>
                  <input
                    value={c.name}
                    disabled={disabled}
                    aria-label={`Name of clip ${i + 1}`}
                    onChange={(e) => onRename(c.id, e.target.value)}
                    className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[13px] font-medium outline-none focus:bg-bg"
                  />
                  <button
                    disabled={disabled}
                    onClick={() => onRemove(c.id)}
                    aria-label={`Remove clip ${c.name}`}
                    className="rounded p-1 text-mute hover:text-bad disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <button
                  onClick={() => onSelect(c)}
                  className="mt-1 flex w-full items-center justify-between rounded px-1 text-left font-mono text-[11px] text-mute hover:text-ink"
                  aria-label={`Review clip ${c.name}`}
                >
                  <span>
                    {formatTime(c.start)} → {formatTime(c.end)}
                  </span>
                  <span className="text-ink">{formatDuration(c.end - c.start)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
