import { useState } from 'react';
import type { MediaItem, RouteCollection, Trip } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { shareOrSaveFiles } from '../lib/fileShare';
import { renderPhotoBook, type BookNote } from '../lib/photobook';
import { Icon } from './Icon';
import './photobook.css';

/**
 * The whole trip as a PDF: cover, map, then a page per day with its note and
 * its photographs.
 *
 * The posters answer "one picture of this trip". This is the other thing
 * people want from a trip that is over - all of it, in order, on paper - and
 * it is made from what this page is already holding.
 */
export function PhotoBook({
  trip,
  stops,
  media,
  routes,
  notes,
}: {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  routes: RouteCollection | null;
  notes: BookNote[];
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function make(theme: 'light' | 'dark') {
    setNote(null);
    setProgress({ done: 0, total: 1 });
    try {
      const pdf = await renderPhotoBook({ trip, stops, media, routes, notes }, theme, (done, total) =>
        setProgress({ done, total }),
      );
      const file = new File([pdf], `${slug(trip.title)}.pdf`, { type: 'application/pdf' });
      const outcome = await shareOrSaveFiles([file], trip.title);
      if (outcome === 'downloaded') setNote('Bewaard in je downloads');
      else if (outcome === 'failed') setNote('Maken lukte niet');
    } catch {
      setNote('Maken lukte niet');
    } finally {
      setProgress(null);
    }
  }

  const pages = media.length === 0 ? 0 : new Set(media.map((m) => m.takenAt.slice(0, 10))).size + 2;
  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <section className="photo-book">
      <h2 className="trip-side-heading">Fotoboek</h2>
      <p className="muted photo-book-hint">
        {pages > 0
          ? `Een PDF van ongeveer ${pages} pagina's: omslag, de route, en per dag je notitie met de foto's van die dag.`
          : 'Zodra deze reis foto’s heeft, kun je er een boek van maken.'}
      </p>

      {progress ? (
        <div className="photo-book-progress">
          <div className="photo-book-bar" style={{ width: `${percent}%` }} />
          <span>
            Pagina {progress.done} van {progress.total}
          </span>
        </div>
      ) : (
        <div className="photo-book-actions">
          <button className="btn btn-primary" disabled={pages === 0} onClick={() => void make('light')}>
            <Icon name="download" size={15} /> Licht
          </button>
          <button className="btn btn-ghost" disabled={pages === 0} onClick={() => void make('dark')}>
            <Icon name="download" size={15} /> Donker
          </button>
        </div>
      )}
      {note && <p className="muted photo-book-note">{note}</p>}
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
