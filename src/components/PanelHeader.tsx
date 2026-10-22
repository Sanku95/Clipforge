import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  icon: ReactNode;
  title: string;
  /** Short status shown on the right (e.g. "3 lines"). */
  summary?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** id of the region this header controls. */
  controls: string;
}

/** A panel title that doubles as the expand/collapse control. */
export function PanelHeader({ icon, title, summary, collapsed, onToggle, controls }: Props) {
  return (
    <h2 className="text-[14px] font-medium">
      <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls={controls}
        className="-m-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md p-1 text-left hover:bg-raised">
        {icon}
        <span>{title}</span>
        <span className="ml-auto flex items-center gap-2 text-[11px] font-normal text-mute">
          {summary}
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "-rotate-90" : ""}`} aria-hidden />
        </span>
      </button>
    </h2>
  );
}
