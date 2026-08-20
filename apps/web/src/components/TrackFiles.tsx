import { useEffect, useRef, useState } from 'react';
import { api, fetchBlobUrl } from '../api/client';
import type { Trip } from '../api/types';
import { shareOrSaveFiles } from '../lib/fileShare';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './trackfiles.css';

interface TrackImportResult {
  found: number;
  added: number;
  outsideTrip: number;
  undated: number;
}

/**
 * Track files in and out, for one of your trips.
 *
 * A route recorded on a watch, in OsmAnd, or on the phone before this app
 * existed is still a trip's route; and a trip that lives here should be able
 * to leave again in a form other maps read.
 *
 * It sits with the other data that comes and goes rather than inside one trip:
 * this is where you look when you are moving things in or out, and the trip is
 * one field of that question.
 */
export function TrackFiles() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [imported, setImported] = useState<TrackImportResult | null>(null);

  useEffect(() => {
    api<Trip[]>('/trips')
      .then((all) => {
        setTrips(all);
        setTripId((current) => current || (all[0]?.id ?? ''));
      })
      .catch(() => undefined);
  }, []);

  const trip = trips.find((t) => t.id === tripId) ?? null;
  const title = trip?.title ?? 'reis';

  async function exportAs(format: 'gpx' | 'kml') {
    setBusy(format);
    setNote(null);
    try {
      const url = await fetchBlobUrl(`/trips/${tripId}/export/${format}`);
      const blob = await fetch(url).then((r) => r.blob());
      const file = new File([blob], `${slug(title)}.${format}`, { type: blob.type });
      const outcome = await shareOrSaveFiles([file], title);
      if (outcome === 'downloaded') setNote('Bewaard in je downloads');
      else if (outcome === 'failed') setNote('Exporteren lukte niet');
    } catch {
      setNote('Exporteren lukte niet');
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File) {
    setBusy('import');
    setNote(null);
    setImported(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      setImported(
        await api<TrackImportResult>(`/trips/${tripId}/import-track`, {
          method: 'POST',
          formData,
        }),
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Importeren mislukt');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card settings-card track-files">
      <h2>Route-bestanden</h2>
      <p className="muted">
        Exporteer een reis als GPX of KML, of voeg een track toe die je ergens anders opnam.
        Punten buiten de reisdagen worden overgeslagen: die horen bij een andere reis.
      </p>

      <TripPicker
        trips={trips}
        value={tripId}
        onChange={(id) => {
          setTripId(id);
          setImported(null);
          setNote(null);
        }}
      />

      <div className="track-files-actions">
        <ExportMenu
          disabled={busy !== null || !tripId}
          busy={busy === 'gpx' || busy === 'kml'}
          onPick={(format) => void exportAs(format)}
        />
        <label className={`btn btn-primary track-files-pick ${busy || !tripId ? 'disabled' : ''}`}>
          <input
            type="file"
            accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
            hidden
            disabled={busy !== null || !tripId}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
          <Icon name="plus" size={15} /> {busy === 'import' ? 'Bezig…' : 'Importeren'}
        </label>
      </div>

      {imported && (
        <p className="track-files-result">
          <Icon name="check" size={15} />
          <span>
            {imported.added} van {imported.found} punten toegevoegd
            {imported.outsideTrip > 0 && `, ${imported.outsideTrip} buiten de reisdagen`}
            {imported.undated > 0 && `, ${imported.undated} zonder tijd`}
            {imported.added === 0 && imported.found > 0 && ' (stonden er al in)'}
          </span>
        </p>
      )}
      {note && <p className="muted track-files-note">{note}</p>}
    </section>
  );
}

/**
 * Which trip, as the app's own dropdown.
 *
 * A native <select> opens the operating system's own wheel, which on Android
 * is a grey list in a font this app uses nowhere else — the one control on the
 * page that came from somewhere else.
 */
function TripPicker({
  trips,
  value,
  onChange,
}: {
  trips: Trip[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, closing] = useExit(open, 150);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = trips.find((t) => t.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="track-picker" ref={wrapRef}>
      <button
        type="button"
        className={`track-picker-btn ${open ? 'open' : ''}`}
        disabled={trips.length === 0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="compass" size={15} />
        <span className="track-picker-name">{current?.title ?? 'Geen reizen'}</span>
        {current && <span className="track-picker-year">{current.startDate.slice(0, 4)}</span>}
        <Icon name="chevron-down" size={15} className="track-picker-caret" />
      </button>

      {mounted && (
        <div className={`track-picker-menu card ${closing ? 'closing' : ''}`}>
          {trips.map((trip, index) => (
            <button
              key={trip.id}
              type="button"
              className={`track-picker-item ${trip.id === value ? 'active' : ''}`}
              style={{ animationDelay: `${Math.min(index, 10) * 16}ms` }}
              onClick={() => {
                onChange(trip.id);
                setOpen(false);
              }}
            >
              <span className="track-picker-name">{trip.title}</span>
              <span className="track-picker-year">{trip.startDate.slice(0, 4)}</span>
              <span className={`track-picker-check ${trip.id === value ? 'on' : ''}`}>
                <Icon name="check" size={14} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One "Exporteren" pill; the two formats live in its menu. */
function ExportMenu({
  disabled,
  busy,
  onPick,
}: {
  disabled: boolean;
  busy: boolean;
  onPick: (format: 'gpx' | 'kml') => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, closing] = useExit(open, 150);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  return (
    <div className="track-export" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="download" size={15} /> {busy ? 'Bezig…' : 'Exporteren'}
        <Icon name="chevron-down" size={14} className={`track-export-caret ${open ? 'on' : ''}`} />
      </button>

      {mounted && (
        <div className={`track-export-menu card ${closing ? 'closing' : ''}`}>
          {(['gpx', 'kml'] as const).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(format);
              }}
            >
              <strong>{format.toUpperCase()}</strong>
              <small>{format === 'gpx' ? 'Voor apps en horloges' : 'Voor Google Earth'}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'reis'
  );
}
