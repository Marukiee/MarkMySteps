import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { searchStations } from '../lib/geocode';
import type { PlaceSuggestion } from '../lib/geocode';
import { useSheetDismiss } from '../lib/useSheetDismiss';
import './trainroute.css';

export interface Station {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
}

/**
 * Where the train left from, and where it put you down.
 *
 * A tracker in a train records almost nothing: a tunnel, a cutting, and a
 * steel carriage between the phone and the sky. Madrid to Barcelona leaves a
 * five-hundred-kilometre hole in the line with no shape to snap to, so unlike
 * the road gesture there is nothing to guess from — the two stations have to
 * be said out loud. From those, the rails between them can be drawn.
 *
 * Only stations are offered, never cities: a city's coordinate is its centre,
 * and rails routed from there start a few kilometres off the platform.
 */
export function TrainRouteSheet({
  onDraw,
  onClose,
  closing,
  prefill,
}: {
  onDraw: (from: Station, to: Station) => Promise<void>;
  onClose: () => void;
  closing: boolean;
  /** City names to start the two searches from, when the sheet was opened from
   *  a leg of the plan that already knows where the train ran between. */
  prefill?: { from: string; to: string };
}) {
  const sheet = useSheetDismiss(onClose);
  const [from, setFrom] = useState<Station | null>(null);
  const [to, setTo] = useState<Station | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draw = async () => {
    if (!from || !to || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDraw(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dat lukte niet');
      setBusy(false);
    }
  };

  return (
    <div className={`people-sheet-backdrop ${closing ? 'closing' : ''}`} onClick={onClose}>
      <div
        className="people-sheet card"
        ref={sheet.ref}
        onClick={(e) => e.stopPropagation()}
        {...sheet.handlers}
      >
        <div className="people-sheet-head">
          <h2>Treinroute tekenen</h2>
          <button className="icon-btn" aria-label="Sluiten" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <p className="muted layer-hint">
          In de trein heeft je telefoon vaak geen signaal. Zeg van welk station naar welk station je
          ging, dan tekent hij het spoor ertussen en sluit hij het aan op je route ervoor en erna.
        </p>

        <StationField
          label="Vertrekstation"
          placeholder="Madrid Atocha"
          initialQuery={prefill?.from}
          value={from}
          onPick={setFrom}
        />
        <StationField
          label="Aankomststation"
          placeholder="Barcelona Sants"
          initialQuery={prefill?.to}
          value={to}
          onPick={setTo}
        />

        {error && <p className="error-text train-error">{error}</p>}

        <div className="layer-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleren
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!from || !to || busy}
            onClick={draw}
          >
            {busy ? 'Tekenen…' : 'Route tekenen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One station box: type, pick from the list, and it stays picked. */
function StationField({
  label,
  placeholder,
  initialQuery,
  value,
  onPick,
}: {
  label: string;
  placeholder: string;
  initialQuery?: string;
  value: Station | null;
  onPick: (station: Station | null) => void;
}) {
  // Opened from a train leg, the box starts on the city the leg runs between,
  // so the stations of that city are already listed.
  const [query, setQuery] = useState(initialQuery ?? '');
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  // Typed a letter at a time, asked for once the typing stops: the geocoder is
  // somebody else's server and every keystroke is not a question.
  useEffect(() => {
    if (value || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      searchStations(query, controller.signal)
        .then((found) => setResults(found))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 320);
    return () => {
      window.clearTimeout(timer);
      setLoading(false);
    };
  }, [query, value]);

  useEffect(() => () => abort.current?.abort(), []);

  if (value) {
    return (
      <div className="train-field">
        <span className="train-label">{label}</span>
        <div className="train-picked">
          <Icon name="train" size={16} />
          <span className="train-picked-name">
            {value.name}
            {value.region && <span className="train-picked-region">{value.region}</span>}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Ander station kiezen"
            onClick={() => {
              onPick(null);
              setQuery('');
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="train-field">
      <label className="train-label" htmlFor={`station-${label}`}>
        {label}
      </label>
      <input
        id={`station-${label}`}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <p className="train-hint muted">Zoeken…</p>}
      {!loading && query.trim().length >= 2 && results.length === 0 && (
        <p className="train-hint muted">Geen station gevonden.</p>
      )}
      {results.length > 0 && (
        <ul className="train-results">
          {results.map((r) => (
            <li key={`${r.name}-${r.latitude}-${r.longitude}`}>
              <button
                type="button"
                className="train-result"
                onClick={() =>
                  onPick({
                    name: r.name,
                    region: r.region,
                    latitude: r.latitude,
                    longitude: r.longitude,
                  })
                }
              >
                <Icon name="train" size={15} />
                <span className="train-result-name">{r.name}</span>
                {r.region && <span className="train-result-region">{r.region}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
