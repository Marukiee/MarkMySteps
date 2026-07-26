import { useEffect, useState } from 'react';

export interface LastSeen {
  /** Compact label: "nu", "40 s", "4 min", "3 uur", "2 d". */
  text: string;
  /** Fixed within the last ten seconds — worth showing in green. */
  fresh: boolean;
}

/** How long ago a position was recorded, in as few characters as possible. */
export function lastSeenLabel(iso: string, now: number = Date.now()): LastSeen {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 10) return { text: 'nu', fresh: true };
  if (secs < 60) return { text: `${secs} s`, fresh: false };
  const mins = Math.round(secs / 60);
  if (mins < 60) return { text: `${mins} min`, fresh: false };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { text: `${hours} uur`, fresh: false };
  return { text: `${Math.round(hours / 24)} d`, fresh: false };
}

/**
 * A clock that re-renders on an interval. Ages are relative, so without this
 * a "nu" would stay "nu" until the next poll comes back thirty seconds later.
 */
export function useNow(everyMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(t);
  }, [everyMs]);
  return now;
}
