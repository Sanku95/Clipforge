import { Sparkles } from "lucide-react";
import { LOOKS, defaultEffects, hasEffects, type EffectsSettings, type LookId } from "../lib/effects";
import type { Project } from "../lib/types";
import { Panel } from "./ui";
import { PanelHeader } from "./PanelHeader";
import { useCollapsed } from "../lib/useCollapsed";

const TOGGLES: { key: "vignette" | "grain" | "fade" | "progress"; label: string; hint: string }[] = [
  { key: "vignette", label: "Soft vignette", hint: "Darkens the corners" },
  { key: "grain", label: "Film grain", hint: "Fine texture" },
  { key: "fade", label: "Fade in and out", hint: "Black, with the sound" },
  { key: "progress", label: "Progress bar", hint: "Thin line along the bottom" }
];

/** A small colourful scene so each look's effect is visible in its tile. */
const SAMPLE = "linear-gradient(135deg,#2b4c7e 0%,#e8b98a 42%,#7fb069 70%,#3a2a4a 100%)";

interface Props { project: Project; onChange: (patch: (p: Project) => Project) => void }

export function EffectsPanel({ project, onChange }: Props) {
  const fx = project.effects ?? defaultEffects();
  const [collapsed, toggleCollapsed] = useCollapsed("effects");
  const set = (next: EffectsSettings) => onChange((p) => ({ ...p, effects: next }));
  return (
    <Panel className="p-4">
      <PanelHeader icon={<Sparkles className="h-4 w-4 text-ember" aria-hidden />} title="Look and effects" collapsed={collapsed} onToggle={toggleCollapsed} controls="effects-body"
        summary={hasEffects(fx) ? "On" : undefined} />
      <div id="effects-body" hidden={collapsed}>
      {hasEffects(fx) && <div className="mt-2 text-right"><button className="text-[11px] text-mute hover:text-ink" onClick={() => set(defaultEffects())}>Reset</button></div>}
      <div role="radiogroup" aria-label="Colour look" className="mt-3 grid grid-cols-3 gap-2">
        {LOOKS.map((l) => {
          const active = fx.look === l.id;
          return (
            <button key={l.id} role="radio" aria-checked={active} title={l.hint} onClick={() => set({ ...fx, look: l.id as LookId })}
              className={`flex flex-col gap-1.5 rounded-lg border p-1.5 text-center transition-colors ${active ? "border-ember bg-ember/10" : "border-line bg-raised hover:border-[#3a3a47]"}`}>
              <span className="block h-10 w-full rounded" style={{ background: SAMPLE, filter: l.css }} />
              <span className="text-[11px] text-ink">{l.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5" checked={fx[t.key]} onChange={(e) => set({ ...fx, [t.key]: e.target.checked })} />
            <span>{t.label}<span className="block text-[11px] leading-tight text-mute">{t.hint}</span></span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-mute">Applied to every clip you export from the browser. The preview approximates the colour; grain and vignette make exports a little slower.</p>
      </div>
    </Panel>
  );
}
