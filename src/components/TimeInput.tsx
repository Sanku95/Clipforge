import { useEffect, useState } from "react";
import { formatTime, parseTime } from "../lib/time";

interface Props {
  label: string;
  value: number;
  max: number;
  onCommit: (seconds: number) => void;
}

/** Text field for an exact time. Accepts 90, 1:30, 1:30.250, 1:02:03.5. */
export function TimeInput({ label, value, max, onCommit }: Props) {
  const [text, setText] = useState(formatTime(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(formatTime(value));
    setInvalid(false);
  }, [value]);

  const commit = () => {
    const parsed = parseTime(text);
    if (parsed === null || parsed > max + 0.0005) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(Math.min(max, parsed));
    setText(formatTime(Math.min(max, parsed)));
  };

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-mute">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setText(formatTime(value));
            setInvalid(false);
          }
        }}
        inputMode="decimal"
        aria-invalid={invalid}
        className={`w-full rounded-lg border bg-raised px-3 py-2 font-mono text-[13px] outline-none ${
          invalid ? "border-bad" : "border-line focus:border-ember"
        }`}
      />
      {invalid && <span className="mt-1 block text-[11px] text-bad">Use a time like 1:30.5 within the video length.</span>}
    </label>
  );
}
