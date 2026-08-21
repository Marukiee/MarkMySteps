import { useEffect, useState } from 'react';
import { bookJob, dismissBook, onBookJob, saveBook, type BookJob } from '../lib/bookJob';
import { useExit } from '../lib/useExit';
import { Icon } from './Icon';
import './bookprogress.css';

/**
 * The photo book being made, as a pill that follows you around the app.
 *
 * The work carries on wherever you go, so something has to carry on saying so
 * — and, when it is finished, offer the file. Sits above the tab bar, where it
 * covers nothing you were reading.
 */
export function BookProgress() {
  const [job, setJob] = useState<BookJob>(bookJob);
  const [shown, closing] = useExit(job.status !== 'idle', 240);

  useEffect(() => onBookJob(setJob), []);

  if (!shown) return null;

  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className={`book-pill ${closing ? 'closing' : ''} ${job.status}`}>
      {job.status === 'running' && (
        <div className="book-pill-bar" style={{ width: `${percent}%` }} aria-hidden />
      )}
      <span className="book-pill-icon">
        <Icon name={job.status === 'done' ? 'check' : job.status === 'failed' ? 'close' : 'book'} size={15} />
      </span>
      <span className="book-pill-text">
        {job.status === 'running' && (
          <>
            <strong>Fotoboek wordt gemaakt</strong>
            <small>
              Pagina {job.done} van {job.total || '…'} · je kunt gewoon verder
            </small>
          </>
        )}
        {job.status === 'done' && (
          <>
            <strong>Fotoboek klaar</strong>
            <small>{job.note ?? job.title}</small>
          </>
        )}
        {job.status === 'failed' && (
          <>
            <strong>Fotoboek mislukt</strong>
            <small>{job.note ?? 'Probeer het opnieuw'}</small>
          </>
        )}
      </span>

      {job.status === 'done' && (
        <button type="button" className="book-pill-save" onClick={() => void saveBook()}>
          Bewaren
        </button>
      )}
      {job.status !== 'running' && (
        <button
          type="button"
          className="book-pill-close"
          aria-label="Sluiten"
          onClick={dismissBook}
        >
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  );
}
