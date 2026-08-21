import { shareOrSaveFiles } from './fileShare';
import { clearJobProgress, notifyPermitted, showJobDone, showJobProgress } from './notify';
import { renderPhotoBook, type BookSource } from './photobook';

export interface BookJob {
  status: 'idle' | 'running' | 'done' | 'failed';
  tripId: string | null;
  title: string;
  done: number;
  total: number;
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

export async function startBook(source: BookSource, dpi: number): Promise<void> {
  if (job.status === 'running') return;
  set({
    status: 'running',
    tripId: source.trip.id,
    title: source.trip.title,
    done: 0,
    total: 0,
    file: null,
    note: null,
  });

  // Asked once, when there is finally something worth notifying about.
  void notifyPermitted();

  // The shade is updated on the way past whole percentages rather than on
  // every page: a hundred notification writes a minute is its own slowdown.
  let lastPercent = -1;
  let lastAt = 0;

  try {
    const pdf = await renderPhotoBook(source, { dpi }, (done, total) => {
      set({ done, total });
      const percent = total > 0 ? Math.round((done / total) * 100) : 0;
      const now = Date.now();
      if (percent !== lastPercent && now - lastAt > 700) {
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
    void showJobDone('Fotoboek klaar', `${source.trip.title} · tik om te bewaren`);
  } catch {
    set({ status: 'failed', note: 'Maken mislukt' });
    void clearJobProgress();
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
