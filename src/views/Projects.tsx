import { useState } from "react";
import { FilePlus2, FolderKanban, Trash2 } from "lucide-react";
import { projectStatus, useProjects } from "../lib/projects";
import { useImport } from "../lib/useImport";
import { formatDuration } from "../lib/time";
import { Badge, Button, EmptyState, ErrorBanner, Spinner } from "../components/ui";

export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { projects, loading, remove } = useProjects();
  const { importVideo, busy, error, clearError } = useImport();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const start = async () => {
    const p = await importVideo();
    if (p) onOpen(p.id);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
        <Button variant="primary" onClick={start} busy={busy}>
          <FilePlus2 className="h-4 w-4" /> New project
        </Button>
      </div>
      {error && <ErrorBanner onDismiss={clearError}>{error}</ErrorBanner>}

      {loading ? (
        <Spinner label="Loading projects…" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-9 w-9" />}
          title="Nothing here yet"
          body="Each project is one source video and the clips you cut from it."
          action={
            <Button variant="primary" onClick={start} busy={busy}>
              <FilePlus2 className="h-4 w-4" /> New project
            </Button>
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3">
          {projects.map((p) => {
            const status = projectStatus(p, false);
            return (
              <li key={p.id} className="rounded-xl border border-line bg-panel p-4">
                <button onClick={() => onOpen(p.id)} className="block w-full text-left">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-[15px] font-medium">{p.name}</span>
                    <Badge tone={status === "Exported" ? "ember" : status === "Ready" ? "ok" : "neutral"}>{status}</Badge>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-mute">{p.source?.file_name ?? "No video"}</div>
                  <div className="mt-3 flex gap-4 text-xs text-mute">
                    {p.source && <span>{formatDuration(p.source.duration)}</span>}
                    {p.source && (
                      <span>
                        {p.source.width}×{p.source.height}
                      </span>
                    )}
                    <span>
                      {p.clips.length} clip{p.clips.length === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto">{new Date(p.updatedAt).toLocaleDateString()}</span>
                  </div>
                </button>
                <div className="mt-3 flex justify-end border-t border-line pt-3">
                  {confirmId === p.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-mute">Delete this project? Your video file is not touched.</span>
                      <Button variant="danger" onClick={() => { remove(p.id); setConfirmId(null); }}>
                        Delete
                      </Button>
                      <Button onClick={() => setConfirmId(null)}>Keep</Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(p.id)}
                      aria-label={`Delete project ${p.name}`}
                      className="rounded p-1 text-mute hover:text-bad"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
