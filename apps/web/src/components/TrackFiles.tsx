import { useEffect, useState } from 'react';
import { api, fetchBlobUrl } from '../api/client';
import type { Trip } from '../api/types';
import { shareOrSaveFiles } from '../lib/fileShare';
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
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [imported, setImported] = useState<TrackImportResult | null>(null);

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

      <div className="field track-files-trip">
        <label htmlFor="tf-trip">Reis</label>
        <select
          id="tf-trip"
          value={tripId}
          disabled={trips.length === 0}
          onChange={(e) => {
            setTripId(e.target.value);
            setImported(null);
            setNote(null);
          }}
        >
          {trips.length === 0 && <option value="">Geen reizen</option>}
          {trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>

      <div className="track-files-actions">
        <button
          className="btn btn-ghost"
          disabled={busy !== null || !tripId}
          onClick={() => void exportAs('gpx')}
        >
          <Icon name="download" size={15} /> {busy === 'gpx' ? 'Bezig…' : 'GPX'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy !== null || !tripId}
          onClick={() => void exportAs('kml')}
        >
          <Icon name="download" size={15} /> {busy === 'kml' ? 'Bezig…' : 'KML'}
        </button>
        <label className={`btn btn-ghost track-files-pick ${busy || !tripId ? 'disabled' : ''}`}>
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
