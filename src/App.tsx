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
  useEffect(() => onPrepareStatus(setMsg), []);
  if (!msg) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 rounded-lg border border-line bg-raised px-4 py-2.5 text-[13px] shadow-lg">
      {msg}
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
