import { useEffect, useState } from "react";
import { onPrepareStatus } from "./lib/api";
import { ProjectsProvider } from "./lib/projects";
import { Sidebar, type Route } from "./components/Sidebar";
import { Dashboard } from "./views/Dashboard";
import { Projects } from "./views/Projects";
import { Roadmap } from "./views/Roadmap";
import { Workspace } from "./views/Workspace";

function PrepareStatus() {
  const [msg, setMsg] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => onPrepareStatus((next) => {
    setMsg(next);
    if (next) {
      setStartedAt((current) => current ?? Date.now());
      setElapsed(0);
    } else {
      setStartedAt(null);
      setElapsed(0);
    }
  }), []);

  useEffect(() => {
    if (!msg || startedAt === null) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [msg, startedAt]);

  if (!msg) return null;
  const elapsedLabel = elapsed < 60 ? `${elapsed}s elapsed` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`;

  return (
    <div role="status" aria-live="polite" className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-xl border border-line bg-raised px-4 py-3 shadow-xl sm:inset-x-auto sm:right-6 sm:w-[min(34rem,calc(100vw-2rem))]">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="font-medium">{msg}</span>
        <span className="shrink-0 text-[11px] text-mute">{elapsedLabel}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel" aria-label="Processing progress">
        <div className="h-full w-1/3 animate-[clipforge-progress_1.4s_ease-in-out_infinite] rounded-full bg-ember" />
      </div>
      <p className="mt-2 text-[11px] text-mute">This runs on your device. Processing time depends on the video format and size.</p>
      <style>{`@keyframes clipforge-progress { 0% { transform: translateX(-110%); } 100% { transform: translateX(330%); } }`}</style>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>("dashboard");
  const [openId, setOpenId] = useState<string | null>(null);

  const navigate = (r: Route) => {
    setOpenId(null);
    setRoute(r);
  };

  return (
    <ProjectsProvider>
      <div className="flex h-full">
        <Sidebar route={route} onNavigate={navigate} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {openId ? (
            <Workspace projectId={openId} onBack={() => setOpenId(null)} />
          ) : route === "dashboard" ? (
            <Dashboard onOpen={setOpenId} onNavigate={navigate} />
          ) : route === "projects" ? (
            <Projects onOpen={setOpenId} />
          ) : (
            <Roadmap />
          )}
        </main>
      </div>
      <PrepareStatus />
    </ProjectsProvider>
  );
}
