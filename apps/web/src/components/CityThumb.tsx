import { useEffect, useState } from 'react';
import { cityPhoto } from '../lib/cityphoto';
import { flagEmoji } from '../lib/colors';

/** Square city photo (Wikipedia) with a numbered badge; flag fallback.
 *  `index` below zero hides the badge — a day trip has no route number. */
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

  useEffect(() => {
    let cancelled = false;
    cityPhoto(name).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <div
      className={`city-thumb ${className}`.trim()}
      style={src ? { backgroundImage: `url(${src})` } : undefined}
    >
      {!src && <span className="city-thumb-flag">{flagEmoji(countryCode) || '🏙️'}</span>}
      {index >= 0 && <span className="city-thumb-badge">{index + 1}</span>}
    </div>
  );
}
