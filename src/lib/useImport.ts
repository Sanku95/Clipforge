import { useCallback, useState } from "react";
import { api, pickVideo } from "./api";
import { useProjects } from "./projects";
import type { Project } from "./types";

/** Native file picker → ffprobe → new project. */
export function useImport() {
  const { create } = useProjects();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importVideo = useCallback(async (): Promise<Project | null> => {
    setError(null);
    setBusy(true);
    try {
      const path = await pickVideo();
      if (!path) return null;
      const info = await api.probeVideo(path);
      const name = info.file_name.replace(/\.[^.]+$/, "");
      return create(name, info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [create]);

  return { importVideo, busy, error, clearError: () => setError(null) };
}
