import { FolderKanban, LayoutDashboard, Map } from "lucide-react";
import { Logo } from "./Logo";

export type Route = "dashboard" | "projects" | "roadmap";

const ITEMS: { id: Route; label: string; icon: typeof Map }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "roadmap", label: "Roadmap", icon: Map }
];

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  return (
    <nav aria-label="Main" className="flex w-[196px] shrink-0 flex-col border-r border-line bg-panel px-3 py-4">
      <div className="mb-6 flex items-center gap-2.5 px-2">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">ClipForge</span>
      </div>
      <ul className="space-y-1">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const active = route === id;
          return (
            <li key={id}>
              <button
                onClick={() => onNavigate(id)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  active ? "bg-ember/12 text-ember" : "text-mute hover:bg-raised hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto px-2 text-[11px] leading-relaxed text-mute">
        Your videos stay on this device.
        <br />
        No telemetry. YouTube links go to Ssemble only if you use AI clips.
      </div>
    </nav>
  );
}
