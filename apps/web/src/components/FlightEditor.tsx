import { useState } from 'react';
import { airportByCode, searchAirports } from '../lib/airports';
import './flighteditor.css';

interface FlightEditorProps {
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
  onSave: (data: { flightNumber?: string; fromAirport?: string; toAirport?: string }) => void;
}

/** Compact flight leg editor: airport pickers (bundled) + manual flight number. */
export function FlightEditor({ flightNumber, fromAirport, toAirport, onSave }: FlightEditorProps) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(fromAirport ?? '');
  const [to, setTo] = useState(toAirport ?? '');
  const [flight, setFlight] = useState(flightNumber ?? '');

  const summary = [fromAirport, toAirport].filter(Boolean).join(' → ');

  if (!open) {
    return (
      <button className="flight-summary" onClick={() => setOpen(true)}>
        ✈ {flightNumber || summary || 'Vluchtgegevens toevoegen'}
      </button>
    );
  }

  return (
    <div className="flight-editor card">
      <div className="flight-row">
        <AirportField label="Van" value={from} onChange={setFrom} />
        <AirportField label="Naar" value={to} onChange={setTo} />
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
