import { useCallback, useState } from "react";

/** Remembered expand/collapse state for a panel. Storage can be blocked, so every access is guarded. */
export function useCollapsed(key: string): [boolean, () => void] {
  const storageKey = `clipforge.collapsed.${key}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem(storageKey, c ? "0" : "1"); } catch { /* not remembered */ }
      return !c;
    });
  }, [storageKey]);
  return [collapsed, toggle];
}
