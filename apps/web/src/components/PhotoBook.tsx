import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MediaItem, RouteCollection, Trip } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { shareOrSaveFiles } from '../lib/fileShare';
import { countBookPages, renderPhotoBook, type BookNote } from '../lib/photobook';
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
  notes,
}: {
  trip: Trip;
  stops: PlannedStop[];
  media: MediaItem[];
  notes: BookNote[];
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The book is always the whole trip. The page's own route follows the day
  // filter, and a book made while looking at one day came out with that day's
  // map and everybody's photographs.
  const [routes, setRoutes] = useState<RouteCollection | null>(null);

  useEffect(() => {
    api<RouteCollection>(`/trips/${trip.id}/route`)
      .then(setRoutes)
      .catch(() => undefined);
  }, [trip.id]);

  async function make(dpi: number) {
    setNote(null);
    setProgress({ done: 0, total: pages || 1 });
    try {
      const pdf = await renderPhotoBook(
        { trip, stops, media, routes, notes },
        { dpi },
        (done, total) => setProgress({ done, total }),
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

  // The real page count: a day with more than six photographs runs onto a
  // second and third page, and every move to the next stop gets its own map.
  const pages = countBookPages({ trip, stops, media, routes, notes });
  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <section className="photo-book">
      <h2 className="trip-side-heading">
        Fotoboek <span className="summary-beta">(bèta)</span>
      </h2>
      <p className="muted photo-book-hint">
        {pages > 0
          ? `Een PDF van ${pages} pagina's: omslag, de route, per dag je notitie met de foto's van die dag, en een kaartje bij elke verplaatsing.`
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
          {/* Snel is 120 dpi, Print 150 — a long book is a lot of drawing, and
              most of them are read on a screen. */}
          <button className="btn btn-primary" disabled={pages === 0} onClick={() => void make(120)}>
            <Icon name="download" size={15} /> Snel
          </button>
          <button className="btn btn-ghost" disabled={pages === 0} onClick={() => void make(150)}>
            <Icon name="download" size={15} /> Print
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
