import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { searchStations } from '../lib/geocode';
import type { StationSuggestion } from '../lib/geocode';
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
  // What is typed in a box that has not been picked from yet, so pressing the
  // button can still make sense of it.
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Pressing the button means what it says.
   *
   * It used to sit there greyed out until both boxes had been picked from a
   * list, which reads as a button that does not work — especially when a box
   * looks filled in already. So: whatever is typed and not yet picked is looked
   * up now, and if a box is genuinely empty the sheet says which one instead of
   * saying nothing at all.
   */
  const draw = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const dep = from ?? (await resolve(fromText));
      const arr = to ?? (await resolve(toText));
      if (!dep || !arr) {
        setError(
          !dep && !arr
            ? 'Vul allebei de stations in.'
            : `Vul nog een ${!dep ? 'vertrekstation' : 'aankomststation'} in.`,
        );
        setBusy(false);
        return;
      }
      if (!from) setFrom(dep);
      if (!to) setTo(arr);
      await onDraw(dep, arr);
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
          Losse fixes die je onderweg toch opving, maken plaats voor het spoor. Je foto&apos;s
          blijven staan.
        </p>

        <StationField
          id="train-from"
          label="Vertrekstation"
          city={prefill?.from}
          value={from}
          onPick={setFrom}
          onType={setFromText}
        />
        <StationField
          id="train-to"
          label="Aankomststation"
          city={prefill?.to}
          value={to}
          onPick={setTo}
          onType={setToText}
        />

        {error && <p className="error-text train-error">{error}</p>}

        <div className="layer-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Annuleren
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={draw}>
            {busy ? 'Tekenen…' : 'Route tekenen'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The best station for a typed name, for a box that was never picked from. */
async function resolve(text: string): Promise<Station | null> {
  if (text.trim().length < 2) return null;
  const [best] = await searchStations(text).catch(() => []);
  return best
    ? { name: best.name, region: best.region, latitude: best.latitude, longitude: best.longitude }
    : null;
}

/**
 * One station box.
 *
 * Opened from a train leg, it does not hand you the name of a city and leave
 * you to look its station up: it looks it up itself and arrives filled in,
 * with the rest of that city's stations one tap away underneath.
 *
 * The list hangs over what is below it rather than pushing it down, and it
 * keeps whatever it last found while the next answer is on its way. A row of
 * suggestions that jumps as you type is a row you cannot hit.
 */
function StationField({
  id,
  label,
  city,
  value,
  onPick,
  onType,
}: {
  id: string;
  label: string;
  /** Looked up on open, and the best station of it is picked straight away. */
  city?: string;
  value: Station | null;
  onPick: (station: Station | null) => void;
  /** What is typed here, so the button can look it up if it was never picked. */
  onType: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StationSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  // The station the leg already implies, found and picked before anybody types
  // anything. Runs once: after that the field belongs to whoever is using it.
  useEffect(() => {
    if (!city) return;
    let live = true;
    setBusy(true);
    searchStations(city)
      .then((found) => {
        if (!live) return;
        setResults(found);
        const best = found[0];
        if (best) {
          onPick({
            name: best.name,
            region: best.region,
            latitude: best.latitude,
            longitude: best.longitude,
          });
        } else {
          // No station under that name. The place itself is still the best
          // start anybody has, so it goes in the box rather than leaving it
          // empty and the search to be typed out from scratch.
          setQuery(city);
          onType(city);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city]);

  // Typed a letter at a time, asked for once the typing stops: the geocoder is
  // somebody else's server and every keystroke is not a question. What it found
  // last time stays up until the new answer arrives.
  useEffect(() => {
    if (query.trim().length < 2) return;
    setBusy(true);
    const timer = window.setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      searchStations(query, controller.signal)
        .then((found) => {
          setResults(found);
          setOpen(true);
        })
        .catch(() => undefined)
        .finally(() => setBusy(false));
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => () => abort.current?.abort(), []);

  // A tap anywhere else closes the list, the way every other picker does.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div className="field train-field" ref={box}>
      <label htmlFor={id}>{label}</label>

      {value ? (
        // Picked: the box reads back as the station, and one tap changes it.
        <button type="button" className="train-picked" onClick={() => onPick(null)}>
          <Icon name="train" size={16} />
          <span className="train-picked-name">
            <strong>
              {value.name}
              {isMainStation(value.name) && <em className="train-main">hoofdstation</em>}
            </strong>
            {value.region && <small>{value.region}</small>}
          </span>
          <span className="train-change">Wijzig</span>
        </button>
      ) : (
        <div className="train-input">
          <input
            id={id}
            type="text"
            autoComplete="off"
            /* The label again, not an example station: a grey "Madrid Atocha"
               reads as something already filled in rather than as a hint. */
            placeholder={label}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onType(e.target.value);
            }}
            onFocus={() => results.length > 0 && setOpen(true)}
          />
          {/* Inside the box, so nothing below it moves while it thinks. */}
          {busy && <span className="train-spinner" aria-hidden="true" />}
        </div>
      )}

      {!value && open && results.length > 0 && (
        <ul className="train-results card">
          {results.map((r) => (
            <li key={`${r.name}-${r.latitude}-${r.longitude}`}>
              <button
                type="button"
                onClick={() => {
                  onPick({
                    name: r.name,
                    region: r.region,
                    latitude: r.latitude,
                    longitude: r.longitude,
                  });
                  setOpen(false);
                }}
              >
                <Icon name="train" size={15} />
                <span>
                  <strong>
                    {r.name}
                    {r.main && <em className="train-main">hoofdstation</em>}
                  </strong>
                  {r.region && <small>{r.region}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The same reading of a name the search does, for a station already picked
 *  (which no longer carries the search's own answer). */
function isMainStation(name: string): boolean {
  const lower = name.toLowerCase();
  return ['centraal', 'central', 'centrale', 'hauptbahnhof', 'hbf', 'termini'].some((w) =>
    lower.includes(w),
  );
}
