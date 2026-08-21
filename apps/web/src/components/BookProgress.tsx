import { useEffect, useState } from 'react';
import { bookJob, dismissBook, onBookJob, saveBook, type BookJob } from '../lib/bookJob';
import { useExit } from '../lib/useExit';
import { AuthImage } from './AuthImage';
import { Icon } from './Icon';
import './bookprogress.css';

/**
 * The finished photo book, offered as a book.
 *
 * While it is being made the notification in the shade says so, which is the
 * point of making it there — nothing needs to sit on top of the app repeating
 * it. What does need a moment of the screen is the end: a file that exists,
 * has a cover, and is about to be lost if nobody saves it.
 */
export function BookProgress() {
  const [job, setJob] = useState<BookJob>(bookJob);
  const finished = job.status === 'done' || job.status === 'failed';
  const [shown, closing] = useExit(finished, 260);

  useEffect(() => onBookJob(setJob), []);

  if (!shown) return null;

  const failed = job.status === 'failed';

  return (
    <div className={`book-done-layer ${closing ? 'closing' : ''}`} onClick={dismissBook}>
      <div className="book-done card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="book-done-close" aria-label="Sluiten" onClick={dismissBook}>
          <Icon name="close" size={16} />
        </button>

        {/* A book, not a file icon: the cover it was made from, with a spine
            down its left edge and a page edge on the right. */}
        <div className={`book-cover ${failed ? 'failed' : ''}`}>
          <div className="book-cover-pages" />
          <div className="book-cover-face">
            {job.coverId && !failed ? (
              <AuthImage path={`/media/${job.coverId}/thumbnail`} alt="" />
            ) : (
              <span className="book-cover-blank">
                <Icon name={failed ? 'close' : 'book'} size={26} />
              </span>
            )}
            <span className="book-cover-spine" />
            <span className="book-cover-title">{job.title}</span>
          </div>
        </div>

        <h3>{failed ? 'Fotoboek mislukt' : 'Fotoboek klaar'}</h3>
        <p className="muted">
          {failed
            ? (job.note ?? 'Er ging iets mis tijdens het maken. Probeer het opnieuw.')
            : `${job.title} · ${job.total} pagina's${job.file ? ` · ${megabytes(job.file.size)}` : ''}`}
        </p>

        {!failed && (
          <button className="btn btn-primary book-done-save" onClick={() => void saveBook()}>
            <Icon name="download" size={16} /> Bewaren
          </button>
        )}
        {job.note && !failed && <p className="muted book-done-note">{job.note}</p>}
      </div>
    </div>
  );
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
