import { useState } from 'react';
import { fetchBlobUrl } from '../api/client';
import { api } from '../api/client';
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
 * Track files in and out.
 *
 * A route recorded on a watch, in OsmAnd, or on the phone before this app
 * existed is still this trip's route; and a trip that lives here should be
 * able to leave again in a form other maps read.
 */
export function TrackFiles({ tripId, title }: { tripId: string; title: string }) {
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
    <section className="ts-sync ts-sync-stacked track-files">
      <div>
        <strong>Route-bestanden</strong>
        <span className="muted">
          Exporteer deze reis als GPX of KML, of voeg een track toe die je ergens anders opnam.
          Punten buiten de reisdagen blijven waar ze zijn.
        </span>
      </div>

      <div className="track-files-actions">
        <button
          className="btn btn-ghost"
          disabled={busy !== null}
          onClick={() => void exportAs('gpx')}
        >
          <Icon name="download" size={15} /> {busy === 'gpx' ? 'Bezig…' : 'GPX'}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy !== null}
          onClick={() => void exportAs('kml')}
        >
          <Icon name="download" size={15} /> {busy === 'kml' ? 'Bezig…' : 'KML'}
        </button>
        <label className={`btn btn-ghost track-files-pick ${busy ? 'disabled' : ''}`}>
          <input
            type="file"
            accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
            hidden
            disabled={busy !== null}
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
      {note && <p className="muted ts-sync-msg">{note}</p>}
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
