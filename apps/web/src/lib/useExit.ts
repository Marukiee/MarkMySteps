import { useEffect, useRef, useState } from 'react';

/**
 * Keeps something mounted long enough to animate away.
 *
 * Conditionally rendering an element gives it an entrance for free and no exit
 * at all: React removes the node the moment the condition flips, so the closing
 * keyframes never run. This holds the node for `ms` with `closing` set, which
 * the stylesheet uses to play the reverse.
 *
 * Returns `[mounted, closing]`.
 */
export function useExit(open: boolean, ms = 220): [boolean, boolean] {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ms);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ms]);

  return [mounted, closing];
}
