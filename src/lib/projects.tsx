import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Clip, Project, ProjectStatus, VideoInfo } from "./types";

interface ProjectsCtx {
  projects: Project[];
  loading: boolean;
  loadError: string | null;
  saveError: string | null;
  create: (name: string, source: VideoInfo | null) => Project;
  update: (id: string, patch: (p: Project) => Project) => void;
  remove: (id: string) => void;
}

const Ctx = createContext<ProjectsCtx | null>(null);

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    api
      .loadProjects()
      .then((list) => {
        setProjects(Array.isArray(list) ? list : []);
        loaded.current = true;
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Debounced save. Never saves before the initial load finished, so a load
  // failure can't overwrite existing projects with an empty list.
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => {
      api
        .saveProjects(projects)
        .then(() => setSaveError(null))
        .catch((e: Error) => setSaveError(e.message));
    }, 400);
    return () => clearTimeout(t);
  }, [projects]);

  const create = useCallback((name: string, source: VideoInfo | null): Project => {
    const now = new Date().toISOString();
    const p: Project = {
      id: newId(),
      name: name.trim() || "Untitled project",
      createdAt: now,
      updatedAt: now,
      source,
      clips: [],
      preset: "vertical",
      pan: 0.5,
      outputDir: null,
      lastExport: null
    };
    loaded.current = true;
    setProjects((prev) => [p, ...prev]);
    return p;
  }, []);

  const update = useCallback((id: string, patch: (p: Project) => Project) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...patch(p), updatedAt: new Date().toISOString() } : p))
    );
  }, []);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const remove = useCallback((id: string) => {
    const gone = projectsRef.current.find((p) => p.id === id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    // Free the stored copy of the video too, unless another project still uses it.
    const path = gone?.source?.path;
    if (path && !projectsRef.current.some((p) => p.id !== id && p.source?.path === path)) void api.forgetSource(path);
  }, []);

  const value = useMemo(
    () => ({ projects, loading, loadError, saveError, create, update, remove }),
    [projects, loading, loadError, saveError, create, update, remove]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjects(): ProjectsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjects must be used inside ProjectsProvider");
  return v;
}

export function projectStatus(p: Project, sourceMissing: boolean): ProjectStatus {
  if (!p.source) return "No video";
  if (sourceMissing) return "Source missing";
  return p.lastExport ? "Exported" : "Ready";
}

export function clipLength(c: Clip): number {
  return Math.max(0, c.end - c.start);
}
