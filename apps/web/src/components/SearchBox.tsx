import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { AuthImage } from './AuthImage';
import { Flag } from './Flag';
import { Icon } from './Icon';
import { useExit } from '../lib/useExit';
import './searchbox.css';

interface SearchResults {
  interpretation: {
    people: { id: string; name: string }[];
    places: string[];
    text: string | null;
  };
  trips: { id: string; title: string; startDate: string; endDate: string }[];
  stops: { id: string; tripId: string; tripTitle: string; name: string; countryCode: string | null }[];
  notes: { tripId: string; tripTitle: string; day: string; snippet: string }[];
  photos: { id: string; tripId: string; tripTitle: string; takenAt: string; assetType: string }[];
}

const EMPTY: SearchResults = {
  interpretation: { people: [], places: [], text: null },
  trips: [],
  stops: [],
  notes: [],
  photos: [],
};

/**
 * One box over everything: trips, places, notes, and the photographs
 * themselves — the last of those answered by Immich, which has already looked
 * at every picture and knows whose face is in it.
 *
 * It starts as a circle beside "nieuwe reis" and grows into a field, because
 * a search box that is always open is a search box that is always in the way
 * on a phone.
 */
export function SearchBox() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [panelOpen, panelClosing] = useExit(open && query.trim().length > 0, 180);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Asking on every keystroke would put a load of vector searches on the
  // Immich server for words nobody finished typing.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(EMPTY);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = window.setTimeout(() => {
      api<SearchResults>(`/search?q=${encodeURIComponent(text)}`)
        .then((found) => !cancelled && setResults(found))
        .catch(() => !cancelled && setResults(EMPTY))
        .finally(() => !cancelled && setBusy(false));
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  // Closing on a tap outside, but not while the on-screen keyboard is what
  // moved: Android fires a resize, not a tap, so listening for pointers only
  // means the field survives the keyboard opening under it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      if (query.trim().length === 0) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (query) setQuery('');
      else setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, query]);

  function expand() {
    setOpen(true);
    // Focus after the width transition starts, or the keyboard opens over a
    // field that is still a circle.
    window.setTimeout(() => inputRef.current?.focus(), 60);
  }

  function go(to: string) {
    setOpen(false);
    setQuery('');
    navigate(to);
  }

  const total =
    results.trips.length + results.stops.length + results.notes.length + results.photos.length;
  const reading = [
    ...results.interpretation.people.map((p) => `foto's van ${p.name}`),
    ...results.interpretation.places.map((p) => `in ${p}`),
    results.interpretation.text ? `over “${results.interpretation.text}”` : null,
  ].filter(Boolean);

  return (
    <div className={`search-box ${open ? 'open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="search-box-btn"
        aria-label="Zoeken"
        onClick={() => (open ? setOpen(false) : expand())}
      >
        <Icon name={open ? 'close' : 'search'} size={18} />
      </button>

      <input
        ref={inputRef}
        className="search-box-input"
        type="search"
        // A phone's autocorrect turns place names into other words, and the
        // keyboard's "search" key should close it rather than submit a form.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Zoek een reis, plek of foto"
        tabIndex={open ? 0 : -1}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.blur()}
      />

      {panelOpen && (
        <div className={`search-panel card ${panelClosing ? 'closing' : ''}`}>
          {reading.length > 0 && (
            <p className="search-reading">
              <Icon name="sparkle" size={13} /> {reading.join(', ')}
            </p>
          )}

          {results.trips.map((trip) => (
            <button key={trip.id} className="search-row" onClick={() => go(`/trips/${trip.id}`)}>
              <span className="search-row-icon">
                <Icon name="compass" size={16} />
              </span>
              <span className="search-row-text">
                <strong>{trip.title}</strong>
                <small>{trip.startDate.slice(0, 4)}</small>
              </span>
            </button>
          ))}

          {results.stops.map((stop) => (
            <button
              key={stop.id}
              className="search-row"
              onClick={() => go(`/trips/${stop.tripId}`)}
            >
              <span className="search-row-icon">
                {stop.countryCode ? <Flag code={stop.countryCode} size={16} /> : <Icon name="pin" size={16} />}
              </span>
              <span className="search-row-text">
                <strong>{stop.name}</strong>
                <small>{stop.tripTitle}</small>
              </span>
            </button>
          ))}

          {results.notes.map((note) => (
            <button
              key={`${note.tripId}-${note.day}`}
              className="search-row"
              onClick={() => go(`/trips/${note.tripId}`)}
            >
              <span className="search-row-icon">
                <Icon name="pencil" size={16} />
              </span>
              <span className="search-row-text">
                <strong>{note.snippet}</strong>
                <small>
                  {note.tripTitle} · {note.day}
                </small>
              </span>
            </button>
          ))}

          {results.photos.length > 0 && (
            <div className="search-photos">
              {results.photos.slice(0, 18).map((photo) => (
                <button
                  key={photo.id}
                  className="search-photo"
                  title={`${photo.tripTitle} · ${photo.takenAt.slice(0, 10)}`}
                  onClick={() => go(`/trips/${photo.tripId}?photo=${photo.id}`)}
                >
                  <AuthImage path={`/media/${photo.id}/thumbnail`} alt="" />
                </button>
              ))}
            </div>
          )}

          {total === 0 && (
            <p className="search-empty">
              {busy ? 'Zoeken…' : 'Niets gevonden. Probeer een plaats, een naam of wat er op de foto staat.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
