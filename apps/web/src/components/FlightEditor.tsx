import { useState } from 'react';
import { airportByCode, searchAirports } from '../lib/airports';
import { getDefaultAirports } from '../lib/prefs';
import { Icon } from './Icon';
import './flighteditor.css';

interface FlightEditorProps {
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
  viaAirports?: string[];
  onSave: (data: {
    flightNumber?: string;
    fromAirport?: string;
    toAirport?: string;
    viaAirports?: string[];
  }) => void;
}

/** Compact flight leg editor: airport pickers (bundled) + layovers + number. */
export function FlightEditor({
  flightNumber,
  fromAirport,
  toAirport,
  viaAirports,
  onSave,
}: FlightEditorProps) {
  const [open, setOpen] = useState(false);
  // A brand-new flight leg starts from your default home airport (Schiphol
  // unless changed in Voorkeuren), so you rarely have to set the origin.
  const [from, setFrom] = useState(fromAirport ?? getDefaultAirports()[0] ?? '');
  const [to, setTo] = useState(toAirport ?? '');
  const [via, setVia] = useState<string[]>(viaAirports ?? []);
  const [flight, setFlight] = useState(flightNumber ?? '');

  const hasRoute = fromAirport && toAirport;
  const summaryStops = [fromAirport, ...(viaAirports ?? []), toAirport].filter(Boolean);

  if (!open) {
    return (
      <button className="flight-summary" onClick={() => setOpen(true)}>
        <Icon name="plane" size={14} />
        {flightNumber ? (
          flightNumber
        ) : hasRoute ? (
          <span className="flight-summary-route">
            {summaryStops.map((code, i) => (
              <span key={i}>
                {i > 0 && <Icon name="chevron-right" size={12} />}
                {code}
              </span>
            ))}
          </span>
        ) : (
          'Toevoegen'
        )}
      </button>
    );
  }

  const setViaAt = (i: number, v: string) =>
    setVia((cur) => cur.map((c, idx) => (idx === i ? v : c)));

  return (
    <div className="flight-editor">
      <div className="flight-row">
        <AirportField label="Van" value={from} onChange={setFrom} />
        <AirportField label="Naar" value={to} onChange={setTo} />
      </div>

      <div className="flight-via">
        <label className="flight-via-label">Tussenstops (overstap)</label>
        {via.map((v, i) => (
          <div key={i} className="flight-via-row">
            <AirportField label="" value={v} onChange={(val) => setViaAt(i, val)} />
            <button
              type="button"
              className="flight-via-remove"
              aria-label="Overstap verwijderen"
              onClick={() => setVia((cur) => cur.filter((_, idx) => idx !== i))}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="flight-via-add"
          onClick={() => setVia((cur) => [...cur, ''])}
        >
          <Icon name="plus" size={14} /> Overstap toevoegen
        </button>
      </div>

      <div className="field">
        <label>Vluchtnummer (handmatig)</label>
        <input
          value={flight}
          placeholder="bijv. KL1703"
          onChange={(e) => setFlight(e.target.value.toUpperCase())}
        />
      </div>
      <div className="flight-actions">
        <button className="btn btn-ghost" onClick={() => setOpen(false)}>
          Annuleren
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            onSave({
              flightNumber: flight || undefined,
              fromAirport: from || undefined,
              toAirport: to || undefined,
              viaAirports: via.map((v) => v.trim().toUpperCase()).filter(Boolean),
            });
            setOpen(false);
          }}
        >
          Opslaan
        </button>
      </div>
    </div>
  );
}

function AirportField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const results = searchAirports(query);
  const selected = airportByCode(value);

  return (
    <div className="field airport-field">
      <label>{label}</label>
      <input
        value={focused ? query : selected ? `${selected.iata} · ${selected.city}` : value}
        placeholder="Vliegveld of code"
        onFocus={() => {
          setFocused(true);
          setQuery('');
        }}
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          // Allow a raw code even if not in the list.
          if (e.target.value.length <= 4) onChange(e.target.value.toUpperCase());
        }}
      />
      {focused && results.length > 0 && (
        <ul className="airport-results card">
          {results.map((a) => (
            <li key={a.iata}>
              <button
                type="button"
                onMouseDown={() => {
                  onChange(a.iata);
                  setQuery('');
                }}
              >
                <strong>{a.iata}</strong> {a.city} <small>{a.name}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
