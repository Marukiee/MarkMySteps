import { useLayoutEffect, useRef, useState } from 'react';
import { Fact } from '../lib/tripFacts';

/**
 * The row of fact chips on a trip header. Always one line, never scrollable:
 * if the four chips don't fit, the labels shorten first ("dagen" → "dgn") and
 * only then does the widest chip drop out.
 */
export function TripFacts({ facts }: { facts: Fact[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);
  const [limit, setLimit] = useState(facts.length);

  // Re-fit whenever the set or the available width changes.
  useLayoutEffect(() => {
    setShort(false);
    setLimit(facts.length);
  }, [facts]);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fit = () => {
      const overflowing = () => row.scrollWidth > row.clientWidth + 1;
      if (!overflowing()) return;
      if (!short) {
        setShort(true);
        return; // remeasure on the next pass with the shorter labels
      }
      setLimit((n) => (n > 1 ? n - 1 : n));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [facts, short, limit]);

  if (facts.length === 0) return null;

  return (
    <div className="trip-headcard-stats" ref={rowRef}>
      {facts.slice(0, limit).map((f) => (
        <span className="tstat" key={f.id}>
          <strong>{f.value}</strong> {short ? f.shortLabel : f.label}
        </span>
      ))}
    </div>
  );
}
