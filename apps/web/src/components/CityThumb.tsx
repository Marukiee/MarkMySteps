import { useEffect, useState } from 'react';
import { cityPhotoCandidates } from '../lib/cityphoto';
import { Flag } from './Flag';

/** Square city photo (Wikipedia) with a numbered badge; flag fallback.
 *  `index` below zero hides the badge: a day trip has no route number. */
export function CityThumb({
  name,
  index,
  countryCode,
  className = '',
}: {
  name: string;
  index: number;
  countryCode: string | null;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  /** Arrived quickly enough to be shown at once, without easing in. */
  const [instant, setInstant] = useState(false);

  // Tries each candidate photo in turn and shows the first that loads; a
  // photo that fails hands over to the next rather than leaving a broken or
  // flickering square.
  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    setSrc(null);
    void cityPhotoCandidates(name).then((list) => {
      const tryAt = (i: number) => {
        if (cancelled || i >= list.length) return;
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setInstant(performance.now() - started < 250);
          setSrc(list[i]!);
        };
        img.onerror = () => tryAt(i + 1);
        img.src = list[i]!;
      };
      tryAt(0);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <div
      className={`city-thumb ${className}`.trim()}
    >
      {src && (
        <span
          className={`city-thumb-photo ${instant ? 'instant' : ''}`}
          style={{ backgroundImage: `url(${src})` }}
          aria-hidden="true"
        />
      )}
      {!src && (
        <span className="city-thumb-flag">
          {countryCode ? <Flag code={countryCode} /> : '🏙️'}
        </span>
      )}
      {index >= 0 && <span className="city-thumb-badge">{index + 1}</span>}
    </div>
  );
}
