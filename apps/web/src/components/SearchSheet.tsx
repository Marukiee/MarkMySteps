import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { popWasOurs, skipNextPop } from '../lib/backStack';
import { useExit } from '../lib/useExit';
import { AuthImage } from './AuthImage';
import { Flag } from './Flag';
import { Icon } from './Icon';
import './searchsheet.css';

export interface SearchFacets {
  people: { id: string; name: string }[];
  countries: { code: string; name: string }[];
}

interface SearchResults {
  interpretation: { people: { id: string; name: string }[]; places: string[]; text: string | null };
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
 * Search, as a page that comes up from the bottom.
 *
 * Typing into a bar wedged into a header means a keyboard over the very list
 * you are searching. A sheet gets the whole screen: the words at the top where
 * the keyboard cannot reach them, the filters under that, and the photographs
 * filling everything below.
 *
 * Nothing is asked of the server until you press search (or enter). Immich
 * answers with vector maths over a whole library, and doing that per keystroke
 * is the kind of thing that makes a self-hosted box warm.
 */
export function SearchSheet({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [facets, setFacets] = useState<SearchFacets>({ people: [], countries: [] });
  const [results, setResults] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersMounted, filtersClosing] = useExit(filtersOpen, 180);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  function close() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 240);
  }

  // What there is to filter by: the people Immich knows faces for and the
  // countries this account has actually been to. Asked once, when the sheet
  // opens, because both change about as often as a passport does.
  useEffect(() => {
    api<SearchFacets>('/search/facets')
      .then(setFacets)
      .catch(() => undefined);
    window.setTimeout(() => inputRef.current?.focus(), 220);
  }, []);

  // The back gesture closes the sheet rather than leaving the page under it.
  useEffect(() => {
    if (closing) return;
    window.history.pushState({ mmsSearch: true }, '');
    let popped = false;
    const onPop = () => {
      if (popWasOurs()) return;
      popped = true;
      close();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) {
        skipNextPop();
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  const canSearch = query.trim().length > 0 || people.length > 0 || countries.length > 0;

  async function run() {
    if (!canSearch) return;
    inputRef.current?.blur();
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      for (const id of people) params.append('person', id);
      for (const code of countries) params.append('country', code);
      setResults(await api<SearchResults>(`/search?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Zoeken mislukt');
      setResults(EMPTY);
    } finally {
      setBusy(false);
    }
  }

  function go(to: string) {
    close();
    window.setTimeout(() => navigate(to), 120);
  }

  const reading = useMemo(() => {
    if (!results) return [];
    return [
      ...results.interpretation.people.map((p) => `foto's van ${p.name}`),
      ...results.interpretation.places.map((p) => `in ${p}`),
      results.interpretation.text ? `over “${results.interpretation.text}”` : null,
    ].filter(Boolean) as string[];
  }, [results]);

  const total = results
    ? results.trips.length + results.stops.length + results.notes.length + results.photos.length
    : 0;
  const activeFilters = people.length + countries.length;

  return createPortal(
    <div className={`search-sheet-backdrop ${closing ? 'closing' : ''}`} onClick={close}>
      <div className="search-sheet card" onClick={(e) => e.stopPropagation()}>
        <div className="search-sheet-grab" />

        <div className="search-sheet-bar">
          <div className="search-sheet-field">
            <Icon name="search" size={17} />
            <input
              ref={inputRef}
              type="text"
              // A phone's autocorrect turns place names into other words, and
              // the keyboard's go key should search rather than submit a form.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="Plek, naam, of wat er op de foto staat"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run();
                if (e.key === 'Escape') close();
              }}
            />
            {query && (
              <button
                type="button"
                className="search-sheet-clear"
                aria-label="Wissen"
                onClick={() => setQuery('')}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-primary search-sheet-go" disabled={!canSearch} onClick={() => void run()}>
            {busy ? 'Bezig…' : 'Zoeken'}
          </button>
          <button type="button" className="search-sheet-close" aria-label="Sluiten" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>

        <button
          type="button"
          className={`search-filter-toggle ${activeFilters > 0 ? 'on' : ''}`}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <Icon name="settings" size={14} />
          Filters
          {activeFilters > 0 && <span className="search-filter-count">{activeFilters}</span>}
          <Icon name="chevron-down" size={14} className={`search-filter-caret ${filtersOpen ? 'on' : ''}`} />
        </button>

        {filtersMounted && (
          <div className={`search-filters ${filtersClosing ? 'closing' : ''}`}>
            {facets.people.length > 0 && (
              <>
                <h3>Wie</h3>
                <div className="search-chips">
                  {facets.people.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className={`search-chip ${people.includes(person.id) ? 'on' : ''}`}
                      onClick={() =>
                        setPeople((current) =>
                          current.includes(person.id)
                            ? current.filter((id) => id !== person.id)
                            : [...current, person.id],
                        )
                      }
                    >
                      {person.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {facets.countries.length > 0 && (
              <>
                <h3>Waar</h3>
                <div className="search-chips">
                  {facets.countries.map((country) => (
                    <button
                      key={country.code}
                      type="button"
                      className={`search-chip ${countries.includes(country.code) ? 'on' : ''}`}
                      onClick={() =>
                        setCountries((current) =>
                          current.includes(country.code)
                            ? current.filter((code) => code !== country.code)
                            : [...current, country.code],
                        )
                      }
                    >
                      <Flag code={country.code} size={14} />
                      {country.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {facets.people.length === 0 && facets.countries.length === 0 && (
              <p className="muted search-empty">
                Nog niets om op te filteren. Namen komen uit de gezichten die Immich herkent,
                landen uit de stops van je reizen.
              </p>
            )}
          </div>
        )}

        <div className="search-sheet-results">
          {error && <p className="error-text">{error}</p>}

          {!results && !busy && (
            <p className="search-empty">
              Zoek op een plaats (“Zweden”), op wie er op staat (“Thijs”), of op wat er te zien is
              (“strand”). Combineren mag: <em>Zweden Thijs</em>.
            </p>
          )}

          {reading.length > 0 && (
            <p className="search-reading">
              <Icon name="sparkle" size={13} /> {reading.join(', ')}
            </p>
          )}

          {results?.photos.length ? (
            <div className="search-photos">
              {results.photos.map((photo) => (
                <button
                  key={photo.id}
                  className="search-photo"
                  title={`${photo.tripTitle} · ${photo.takenAt.slice(0, 10)}`}
                  onClick={() => go(`/trips/${photo.tripId}?photo=${photo.id}`)}
                >
                  <AuthImage path={`/media/${photo.id}/thumbnail?size=thumbnail`} alt="" />
                  {photo.assetType === 'VIDEO' && (
                    <span className="search-photo-play">
                      <Icon name="play" size={14} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : null}

          {results?.trips.map((trip) => (
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

          {results?.stops.map((stop) => (
            <button key={stop.id} className="search-row" onClick={() => go(`/trips/${stop.tripId}`)}>
              <span className="search-row-icon">
                {stop.countryCode ? <Flag code={stop.countryCode} size={16} /> : <Icon name="pin" size={16} />}
              </span>
              <span className="search-row-text">
                <strong>{stop.name}</strong>
                <small>{stop.tripTitle}</small>
              </span>
            </button>
          ))}

          {results?.notes.map((note) => (
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

          {results && total === 0 && !busy && (
            <p className="search-empty">
              Niets gevonden. Probeer een andere plaats of naam, of laat het zoekveld leeg en kies
              alleen een filter.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
