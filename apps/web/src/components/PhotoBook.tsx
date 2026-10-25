import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MediaItem, RouteCollection, Trip } from '../api/types';
import type { PlannedStop } from '../lib/arc';
import { bookJob, cancelBook, onBookJob, startBook } from '../lib/bookJob';
import { countBookPages, type BookNote } from '../lib/photobook';
import { Icon } from './Icon';
import { t } from '../i18n';
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
  // The job itself lives outside this panel, so leaving the page does not
  // throw away twenty minutes of drawing.
  const [job, setJob] = useState(bookJob);
  useEffect(() => onBookJob(setJob), []);
  // The book is always the whole trip. The page's own route follows the day
  // filter, and a book made while looking at one day came out with that day's
  // map and everybody's photographs.
  const [routes, setRoutes] = useState<RouteCollection | null>(null);

  useEffect(() => {
    api<RouteCollection>(`/trips/${trip.id}/route`)
      .then(setRoutes)
      .catch(() => undefined);
  }, [trip.id]);

  function make(dpi: number) {
    void startBook({ trip, stops, media, routes, notes }, dpi);
  }

  // The real page count: a day with more than six photographs runs onto a
  // second and third page, and every move to the next stop gets its own map.
  const pages = countBookPages({ trip, stops, media, routes, notes });
  const running = job.status === 'running' && job.tripId === trip.id;
  const percent = job.total > 0 ? (job.done / job.total) * 100 : 0;
  const busy = job.status === 'running';

  return (
    <section className="photo-book">
      <h2 className="trip-side-heading">
        {t('book.title')} <span className="summary-beta">{t('book.beta')}</span>
      </h2>
      <p className="muted photo-book-hint">
        {pages > 0
          ? t('book.hint', { count: pages })
          : t('book.hintEmpty')}
      </p>

      {running ? (
        <div className="photo-book-running">
          <div className="photo-book-progress">
            <div className="photo-book-bar" style={{ width: `${percent}%` }} />
            <span>{t('book.progress', { done: job.done, total: job.total || '…' })}</span>
          </div>
          <button className="btn btn-ghost photo-book-cancel" onClick={cancelBook}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <div className="photo-book-actions">
          {/* Snel is 120 dpi, Print 150 — a long book is a lot of drawing, and
              most of them are read on a screen. */}
          <button
            className="btn btn-primary"
            disabled={pages === 0 || busy}
            onClick={() => make(120)}
          >
            <Icon name="download" size={15} /> {t('book.quick')}
          </button>
          <button
            className="btn btn-ghost"
            disabled={pages === 0 || busy}
            onClick={() => make(150)}
          >
            <Icon name="download" size={15} /> {t('book.print')}
          </button>
        </div>
      )}
      {running && (
        <p className="muted photo-book-note">
          {t('book.runningNote')}
        </p>
      )}
      {busy && !running && (
        <p className="muted photo-book-note">{t('book.busyOther')}</p>
      )}
    </section>
  );
}
