import { useState } from 'react';
import { airportByCode, searchAirports } from '../lib/airports';
import { getDefaultAirports, setDefaultAirports } from '../lib/prefs';
import { Icon } from './Icon';
import './airportprefs.css';

/**
 * Pick your home / default departure airports (Schiphol by default). The first
 * chip is the primary one, pre-filled on new flight legs. Used both in the
 * onboarding and in Settings › Voorkeuren.
 */
export function AirportPrefs({ onChange }: { onChange?: (codes: string[]) => void }) {
  const [codes, setCodes] = useState<string[]>(getDefaultAirports());
  const [query, setQuery] = useState('');
  const results = query
    ? searchAirports(query)
        .filter((a) => !codes.includes(a.iata))
        .slice(0, 6)
    : [];

  const update = (next: string[]) => {
    const cleaned = next.length > 0 ? next : ['AMS'];
    setCodes(cleaned);
    setDefaultAirports(cleaned);
    onChange?.(cleaned);
  };
  const add = (code: string) => {
    if (!codes.includes(code)) update([...codes, code]);
    setQuery('');
  };

  return (
    <div className="airport-prefs">
      <div className="airport-chips">
        {codes.map((c, i) => {
          const a = airportByCode(c);
          return (
            <span key={c} className={`airport-chip ${i === 0 ? 'primary' : ''}`}>
              {i === 0 && <span className="airport-chip-tag">standaard</span>}
              <strong>{c}</strong>
              {a && <small>{a.city}</small>}
              <button
                type="button"
                aria-label={`${c} verwijderen`}
                onClick={() => update(codes.filter((x) => x !== c))}
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          );
        })}
      </div>
      <div className="airport-pref-search">
        <input
          value={query}
          placeholder="Vliegveld toevoegen (bv. Eindhoven)"
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="airport-pref-results card">
            {results.map((a) => (
              <li key={a.iata}>
                <button type="button" onClick={() => add(a.iata)}>
                  <strong>{a.iata}</strong> {a.city} <small>{a.name}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
