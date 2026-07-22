import { useEffect, useState } from 'react';
import { cityPhoto } from '../lib/cityphoto';
import { flagEmoji } from '../lib/colors';

/** Square city photo (Wikipedia) with a numbered badge; flag fallback. */
export function CityThumb({
  name,
  index,
  countryCode,
}: {
  name: string;
  index: number;
  countryCode: string | null;
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
    <div className="city-thumb" style={src ? { backgroundImage: `url(${src})` } : undefined}>
      {!src && <span className="city-thumb-flag">{flagEmoji(countryCode) || '🏙️'}</span>}
      <span className="city-thumb-badge">{index + 1}</span>
    </div>
  );
}
