import { useCallback, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { Clip } from "../lib/types";
import { formatTime } from "../lib/time";

interface Props {
  duration: number;
  playhead: number;
  inPoint: number;
  outPoint: number;
  clips: Clip[];
  selectedId: string | null;
  onSeek: (t: number) => void;
  onChangeIn: (t: number) => void;
  onChangeOut: (t: number) => void;
}

type Drag = "seek" | "in" | "out" | null;

export function Timeline({ duration, playhead, inPoint, outPoint, clips, selectedId, onSeek, onChangeIn, onChangeOut }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(null);

  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

  const timeAt = useCallback(
    (clientX: number) => {
      const r = track.current?.getBoundingClientRect();
      if (!r || r.width === 0) return 0;
      return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration));
    },
    [duration]
  );

  const apply = (kind: Drag, t: number) => {
    if (kind === "seek") onSeek(t);
    else if (kind === "in") onChangeIn(t);
    else if (kind === "out") onChangeOut(t);
  };

  const down = (kind: Drag) => (e: PointerEvent) => {
    e.stopPropagation();
    drag.current = kind;
    track.current?.setPointerCapture(e.pointerId);
    apply(kind, timeAt(e.clientX));
  };

  const move = (e: PointerEvent) => {
    if (drag.current) apply(drag.current, timeAt(e.clientX));
  };

  const up = (e: PointerEvent) => {
    drag.current = null;
    track.current?.releasePointerCapture(e.pointerId);
  };

  const handleKeys = (kind: "in" | "out", value: number) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      apply(kind, Math.max(0, value - step));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      apply(kind, Math.min(duration, value + step));
    }
  };

  const ticks = 10;
  return (
    <div className="select-none">
      <div className="mb-1 flex justify-between font-mono text-[10px] text-mute" aria-hidden>
        {Array.from({ length: ticks + 1 }, (_, i) => (
          <span key={i}>{formatTime((duration * i) / ticks, false)}</span>
        ))}
      </div>
      <div
        ref={track}
        className="relative h-16 cursor-pointer touch-none rounded-lg border border-line bg-raised"
        onPointerDown={down("seek")}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid="timeline-track"
      >
        {clips.map((c) => (
          <div
            key={c.id}
            className={`absolute top-1 bottom-1 rounded ${c.id === selectedId ? "bg-ember/35 ring-1 ring-ember/70" : "bg-white/10"}`}
            style={{ left: pct(c.start), width: `calc(${pct(c.end)} - ${pct(c.start)})` }}
            title={c.name}
          />
        ))}

        <div
          className="pointer-events-none absolute top-0 bottom-0 border-y-2 border-ember bg-ember/15"
          style={{ left: pct(inPoint), width: `calc(${pct(outPoint)} - ${pct(inPoint)})` }}
        />

        <div
          role="slider"
          tabIndex={0}
          aria-label="In point"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Number(inPoint.toFixed(2))}
          aria-valuetext={formatTime(inPoint)}
          onKeyDown={handleKeys("in", inPoint)}
          onPointerDown={down("in")}
          className="absolute top-0 bottom-0 z-10 w-3 -translate-x-full cursor-ew-resize rounded-l-md bg-ember"
          style={{ left: pct(inPoint) }}
        />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Out point"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Number(outPoint.toFixed(2))}
          aria-valuetext={formatTime(outPoint)}
          onKeyDown={handleKeys("out", outPoint)}
          onPointerDown={down("out")}
          className="absolute top-0 bottom-0 z-10 w-3 cursor-ew-resize rounded-r-md bg-ember"
          style={{ left: pct(outPoint) }}
        />

        <div className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-white" style={{ left: pct(playhead) }}>
          <div className="absolute -top-1 -left-[4px] h-2 w-2 rotate-45 bg-white" />
        </div>
      </div>
    </div>
  );
}
