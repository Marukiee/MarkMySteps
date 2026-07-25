import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Airport, airportByCode, nearestAirport, searchAirports } from '../lib/airports';
import { getDefaultAirports } from '../lib/prefs';
import { Icon } from './Icon';
import './flighteditor.css';

interface FlightEditorProps {
  flightNumber: string | null;
  fromAirport: string | null;
  toAirport: string | null;
  viaAirports?: string[];
  /** [lng,lat] of the leg's origin city — auto-fills "Van" with the nearest
   *  airport when no airport is set yet. */
  fromCity?: [number, number] | null;
  /** [lng,lat] of the leg's destination city — auto-fills "Naar". */
  toCity?: [number, number] | null;
  onSave: (data: {
    flightNumber?: string;
    fromAirport?: string;
    toAirport?: string;
    viaAirports?: string[];
  }) => void;
}

/**
 * Flight leg: a slim summary pill on the plan row, and — when tapped — a sheet
 * that slides up over the page (portalled to <body>, so it is never squeezed
 * into the narrow leg bar). The sheet shows the route as boarding-pass style
 * boxes; tapping one opens a full-height airport search inside the same sheet.
 */
export function FlightEditor({
  flightNumber,
  fromAirport,
  toAirport,
  viaAirports,
  fromCity,
  toCity,
  onSave,
}: FlightEditorProps) {
  const [open, setOpen] = useState(false);

  const hasRoute = fromAirport && toAirport;
  const summaryStops = [fromAirport, ...(viaAirports ?? []), toAirport].filter(Boolean);

  return (
    <>
      <button
        type="button"
        className={`flight-summary ${hasRoute || flightNumber ? 'set' : ''}`}
        onClick={() => setOpen(true)}
      >
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
      {open && (
        <FlightSheet
          flightNumber={flightNumber}
          fromAirport={fromAirport}
          toAirport={toAirport}
          viaAirports={viaAirports}
          fromCity={fromCity}
          toCity={toCity}
          onClose={() => setOpen(false)}
          onSave={onSave}
        />
      )}
    </>
  );
}

type PickTarget =
  | { kind: 'from' }
  | { kind: 'to' }
  | { kind: 'via'; index: number };

function FlightSheet({
  flightNumber,
  fromAirport,
  toAirport,
  viaAirports,
  fromCity,
  toCity,
  onClose,
  onSave,
}: Omit<FlightEditorProps, 'onSave'> & {
  onClose: () => void;
  onSave: FlightEditorProps['onSave'];
}) {
  // Prefill what we can infer: an explicit airport wins, else the airport
  // nearest the known city, else (for the origin) your default home airport.
  const [from, setFrom] = useState(
    fromAirport ??
      (fromCity ? nearestAirport(fromCity[0], fromCity[1])?.iata : undefined) ??
      getDefaultAirports()[0] ??
      '',
  );
  const [to, setTo] = useState(
    toAirport ?? (toCity ? nearestAirport(toCity[0], toCity[1])?.iata : undefined) ?? '',
  );
  const [via, setVia] = useState<string[]>(viaAirports ?? []);
  const [flight, setFlight] = useState(flightNumber ?? '');
  const [picking, setPicking] = useState<PickTarget | null>(null);
  const [pickerClosing, setPickerClosing] = useState(false);
  const [removingVia, setRemovingVia] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);

  /** Slide the search screen back out before unmounting it. */
  const closePicker = () => {
    setPickerClosing(true);
    window.setTimeout(() => {
      setPicking(null);
      setPickerClosing(false);
    }, 200);
  };

  /** Collapse a layover chip away before it disappears from the list. */
  const removeVia = (index: number) => {
    setRemovingVia(index);
    window.setTimeout(() => {
      setVia((cur) => cur.filter((_, i) => i !== index));
      setRemovingVia(null);
    }, 200);
  };

  const close = () => {
    setClosing(true);
    window.setTimeout(onClose, 200);
  };

  // Esc closes the picker first, then the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (picking) closePicker();
      else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  const pick = (code: string) => {
    if (!picking) return;
    if (picking.kind === 'from') setFrom(code);
    else if (picking.kind === 'to') setTo(code);
    else {
      const at = picking.index;
      setVia((cur) => cur.map((c, i) => (i === at ? code : c)));
    }
    closePicker();
  };

  const save = () => {
    onSave({
      flightNumber: flight.trim() || undefined,
      fromAirport: from || undefined,
      toAirport: to || undefined,
      viaAirports: via.map((v) => v.trim().toUpperCase()).filter(Boolean),
    });
    close();
  };

  const pickerTitle =
    picking?.kind === 'from'
      ? 'Vertrek vanaf'
      : picking?.kind === 'to'
        ? 'Aankomst op'
        : 'Overstap op';

  return createPortal(
    <div className={`fe-layer ${closing ? 'closing' : ''}`}>
      <div className="fe-scrim" onClick={close} />
      <div className="fe-sheet" role="dialog" aria-modal="true" aria-label="Vlucht bewerken">
        <div className="fe-grab" aria-hidden="true" />

        <header className="fe-head">
          <strong>Vlucht</strong>
          <button type="button" className="fe-icon-btn" aria-label="Sluiten" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="fe-body">
          <div className="fe-route">
            <AirportBox
              label="Van"
              code={from}
              onPick={() => setPicking({ kind: 'from' })}
            />
            <span className="fe-route-link" aria-hidden="true">
              <span className="fe-route-line" />
              <Icon name="plane" size={18} />
              <span className="fe-route-line" />
            </span>
            <AirportBox label="Naar" code={to} onPick={() => setPicking({ kind: 'to' })} />
          </div>

          <section className="fe-vias">
            <h4>Overstappen</h4>
            {via.length === 0 && <p className="fe-hint">Directe vlucht.</p>}
            {via.map((code, i) => {
              const a = airportByCode(code);
              return (
                <div key={i} className={`fe-via-row ${removingVia === i ? 'leaving' : ''}`}>
                  <button
                    type="button"
                    className="fe-via-chip"
                    onClick={() => setPicking({ kind: 'via', index: i })}
                  >
                    <Icon name="pin" size={13} />
                    <strong>{code || 'Kies vliegveld'}</strong>
                    {a && <small>{a.city}</small>}
                  </button>
                  <button
                    type="button"
                    className="fe-icon-btn fe-via-remove"
                    aria-label="Overstap verwijderen"
                    onClick={() => removeVia(i)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="fe-add-via"
              onClick={() => {
                setVia((cur) => [...cur, '']);
                setPicking({ kind: 'via', index: via.length });
              }}
            >
              <Icon name="plus" size={15} /> Overstap toevoegen
            </button>
          </section>

          <label className="fe-field">
            <span>Vluchtnummer</span>
            <input
              value={flight}
              placeholder="bijv. KL1703"
              inputMode="text"
              autoCapitalize="characters"
              onChange={(e) => setFlight(e.target.value.toUpperCase())}
            />
          </label>
        </div>

        <footer className="fe-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Annuleren
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Opslaan
          </button>
        </footer>

        {picking && (
          <AirportPicker
            title={pickerTitle}
            closing={pickerClosing}
            onBack={closePicker}
            onPick={pick}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One end of the route: big IATA code, city underneath. */
function AirportBox({
  label,
  code,
  onPick,
}: {
  label: string;
  code: string;
  onPick: () => void;
}) {
  const a = airportByCode(code);
  return (
    <button type="button" className={`fe-airport ${code ? 'set' : ''}`} onClick={onPick}>
      <span className="fe-airport-label">{label}</span>
      <strong className="fe-airport-code">{code || '—'}</strong>
      <span className="fe-airport-city">{a ? a.city : 'Kies vliegveld'}</span>
    </button>
  );
}

/** Full-height search inside the sheet: type a city, code or airport name. */
function AirportPicker({
  title,
  closing,
  onBack,
  onPick,
}: {
  title: string;
  closing: boolean;
  onBack: () => void;
  onPick: (code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const home = getDefaultAirports();
  const results: Airport[] = query.trim()
    ? searchAirports(query, 20)
    : (home.map(airportByCode).filter(Boolean) as Airport[]);

  return (
    <div className={`fe-picker ${closing ? 'closing' : ''}`}>
      <header className="fe-head">
        <button type="button" className="fe-icon-btn" aria-label="Terug" onClick={onBack}>
          <Icon name="arrow-left" size={18} />
        </button>
        <strong>{title}</strong>
      </header>
      <div className="fe-picker-search">
        <Icon name="search" size={16} />
        <input
          autoFocus
          value={query}
          placeholder="Stad, vliegveld of code"
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* A code that isn't in the bundled list can still be used as-is. */}
        {query.trim().length >= 3 && query.trim().length <= 4 && (
          <button
            type="button"
            className="fe-use-raw"
            onClick={() => onPick(query.trim().toUpperCase())}
          >
            Gebruik “{query.trim().toUpperCase()}”
          </button>
        )}
      </div>
      <ul className="fe-picker-list">
        {!query.trim() && home.length > 0 && <li className="fe-picker-group">Jouw vliegvelden</li>}
        {results.map((a) => (
          <li key={a.iata}>
            <button type="button" onClick={() => onPick(a.iata)}>
              <span className="fe-picker-code">{a.iata}</span>
              <span className="fe-picker-name">
                <strong>{a.city}</strong>
                <small>{a.name}</small>
              </span>
            </button>
          </li>
        ))}
        {query.trim() && results.length === 0 && (
          <li className="fe-picker-empty">Niets gevonden.</li>
        )}
      </ul>
    </div>
  );
}
