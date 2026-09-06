import { shareOrSaveFiles } from './fileShare';
import {
  clearJobProgress,
  jobCancelled,
  notify,
  notifyPermitted,
  showJobProgress,
} from './notify';
import type { BookSource } from './photobook';

export interface BookJob {
  status: 'idle' | 'running' | 'done' | 'failed';
  tripId: string | null;
  title: string;
  done: number;
  total: number;
  /** The trip's cover photo, for the panel that offers the finished book. */
  coverId: string | null;
  /** The finished book, waiting to be handed to the share sheet. */
  file: File | null;
  note: string | null;
}

const IDLE: BookJob = {
  status: 'idle',
  tripId: null,
  title: '',
  done: 0,
  total: 0,
  coverId: null,
  file: null,
  note: null,
};

/**
 * Making a photo book, in the background.
 *
 * The work lives here rather than in the panel that started it, because a book
 * of ninety pages takes minutes and nobody should have to sit on one screen
 * watching it. Leave the page, look at another trip, put the phone in your
 * pocket: the pages keep being drawn, the notification says how far it has
 * got, and the finished file waits to be saved.
 *
 * One at a time. Two books at once would fight over the same photo cache and
 * finish later than they would have done one after the other.
 */
let job: BookJob = IDLE;
const listeners = new Set<(job: BookJob) => void>();

export function bookJob(): BookJob {
  return job;
}

export function onBookJob(fn: (job: BookJob) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(next: Partial<BookJob>): void {
  job = { ...job, ...next };
  for (const fn of listeners) fn(job);
}

/** Set while a job should stop: the panel's button, or the notification's. */
let cancelling = false;

/** Stops the book being made. What has been drawn so far is thrown away. */
export function cancelBook(): void {
  if (job.status !== 'running') return;
  cancelling = true;
  set({ note: 'Annuleren…' });
}

export async function startBook(source: BookSource, dpi: number): Promise<void> {
  if (job.status === 'running') return;
  cancelling = false;
  set({
    status: 'running',
    tripId: source.trip.id,
    title: source.trip.title,
    done: 0,
    total: 0,
    coverId: source.trip.resolvedCoverId ?? source.media[0]?.id ?? null,
    file: null,
    note: null,
  });

  // Asked for now, and waited for: posting before the answer comes back is
  // how the notification ended up never appearing at all. A refusal is not a
  // reason to stop — the pill in the app says the same thing.
  const mayNotify = await notifyPermitted();
  if (mayNotify) {
    await showJobProgress(`Fotoboek · ${source.trip.title}`, 'Voorbereiden…', 0);
  }

  // The shade is updated on the way past whole percentages rather than on
  // every page: a hundred notification writes a minute is its own slowdown.
  let lastPercent = -1;
  let lastAt = 0;

  try {
    // The whole book renderer - layout, the PDF writer, the map drawing - is
    // pulled in the moment somebody asks for a book, not on every launch. It
    // is the largest thing in the app and most sessions never make one.
    const { renderPhotoBook } = await import('./photobook');
    const pdf = await renderPhotoBook(source, { dpi }, (done, total) => {
      // Thrown from inside the renderer, which is exactly where it has to
      // stop: between two pages, with nothing half-drawn.
      if (cancelling) throw new CancelledError();
      set({ done, total });
      // The notification's own button leaves a flag behind; this is where it
      // is picked up. Asked once a page, which is often enough to feel instant
      // and rare enough to cost nothing.
      void jobCancelled().then((yes) => {
        if (yes) cancelling = true;
      });
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      const now = Date.now();
      if (mayNotify && percent !== lastPercent && now - lastAt > 700) {
        lastPercent = percent;
        lastAt = now;
        void showJobProgress(
          `Fotoboek · ${source.trip.title}`,
          `Pagina ${done} van ${total}`,
          percent,
        );
      }
    });

    const file = new File([pdf], `${slug(source.trip.title)}.pdf`, { type: 'application/pdf' });
    set({ status: 'done', file, note: null });
    // The quiet progress notification goes away and a real one takes its
    // place: finishing is worth hearing about, every percent along the way is
    // not.
    void clearJobProgress();
    if (mayNotify) {
      notify('Fotoboek klaar', `${source.trip.title} · open de app om te bewaren`);
    }
  } catch (err) {
    void clearJobProgress();
    if (err instanceof CancelledError) {
      // Nothing to show and nothing to save: it was called off on purpose.
      dismissBook();
      return;
    }
    set({ status: 'failed', note: 'Maken mislukt' });
  } finally {
    cancelling = false;
  }
}

/** Hands the finished book to the share sheet, then puts the job away. */
export async function saveBook(): Promise<void> {
  if (!job.file) return;
  const outcome = await shareOrSaveFiles([job.file], job.title);
  if (outcome === 'cancelled') return;
  set({ note: outcome === 'downloaded' ? 'Bewaard in je downloads' : null });
  if (outcome !== 'failed') dismissBook();
}

export function dismissBook(): void {
  job = IDLE;
  for (const fn of listeners) fn(job);
  void clearJobProgress();
}

/** Not a failure: the job was called off. */
class CancelledError extends Error {}

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
