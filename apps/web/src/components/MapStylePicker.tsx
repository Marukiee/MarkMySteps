import { useState } from 'react';
import { getMapStyleId, MAP_STYLES, MapStyleId, setMapStyleId } from '../lib/prefs';
import './mapstyle.css';

/**
 * Which map you are looking at, as four painted thumbnails.
 *
 * Offered in two places, which is why it is a component and not a block of
 * settings-page markup: the app's own settings, and the map's settings sheet —
 * where you want it, because that is where you are looking at the map you are
 * about to change.
 */
export function MapStylePicker({ compact = false }: { compact?: boolean }) {
  const [style, setStyle] = useState<MapStyleId>(getMapStyleId());

  return (
    <div className={`map-style-grid ${compact ? 'compact' : ''}`}>
      {MAP_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`map-style-opt ${style === s.id ? 'active' : ''}`}
          onClick={() => {
            setStyle(s.id);
            setMapStyleId(s.id);
          }}
        >
          <span className={`map-style-preview map-style-${s.id}`} aria-hidden="true" />
          {s.label}
        </button>
      ))}
    </div>
  );
}
