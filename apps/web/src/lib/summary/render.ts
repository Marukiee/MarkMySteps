import { loadPhotos, PALETTES, readyFonts } from './canvas';
import { buildPages, templateForPage } from './data';
import { TEMPLATES } from './templates';
import { FORMATS, type PageData, type SummarySource, type SummarySpec } from './types';
import { t } from '../../i18n';

export interface RenderedPage {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  /** Where the photographs on this page are, for tapping one to change it. */
  slots: { id: string | null; box: { x: number; y: number; w: number; h: number } }[];
}

/**
 * Draws every page of a summary.
 *
 * Rendering happens here rather than on the server: this is the only place
 * that already has the photos, the fonts and the route in memory, and a poster
 * made here looks exactly like the preview you approved.
 */
export async function renderSummary(
  source: SummarySource,
  spec: SummarySpec,
  onProgress?: (done: number, total: number) => void,
  /** Set once a newer change has made this render pointless. */
  signal?: AbortSignal,
): Promise<{ pages: RenderedPage[]; data: PageData[] }> {
  await readyFonts();
  signal?.throwIfAborted();
  const built = await buildPages(source, spec);
  signal?.throwIfAborted();
  // Every page's photographs fetched together, before anything is drawn, so
  // the drawing never waits on the network and a missing one can be replaced.
  const data = await Promise.all(built.map(settlePhotos));
  const format = FORMATS[spec.format];
  const out: RenderedPage[] = [];

  for (let i = 0; i < data.length; i++) {
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = format.width;
    canvas.height = format.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(t('summary.error.noCanvas'));

    const template = templateForPage(spec, i, data.length);
    const render = TEMPLATES[template] ?? TEMPLATES.route!;
    const slots: RenderedPage['slots'] = [];
    await render(ctx, { w: format.width, h: format.height }, data[i]!, {
      showLogo: spec.showLogo,
      palette: PALETTES[spec.theme] ?? PALETTES.dark,
      slots,
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      // JPEG at 0.92: a poster is a photograph, and a PNG of one is four times
      // the size for no visible gain.
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) throw new Error(t('summary.error.render'));
    out.push({
      blob,
      url: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      slots,
    });
    onProgress?.(i + 1, data.length);
  }
  return { pages: out, data };
}

/**
 * Only photographs that actually load go on a page.
 *
 * A photo deleted in Immich, or one whose thumbnail fails, left a blank tile
 * where it should have been. It is now replaced by another photo from the same
 * period; where a photo carries the name of its place it is dropped together
 * with that name instead, so the names never shift one place along.
 */
async function settlePhotos(page: PageData): Promise<PageData> {
  if (page.photos.length === 0) return page;
  const loaded = await loadPhotos(page.photos);
  if (loaded.every(Boolean)) return page;

  const photos: string[] = [];
  const labels: string[] = [];
  const spare = [...page.spare];
  for (let i = 0; i < page.photos.length; i++) {
    if (loaded[i]) {
      photos.push(page.photos[i]!);
      if (page.photoLabels) labels.push(page.photoLabels[i] ?? '');
      continue;
    }
    if (page.photoLabels) continue;
    while (spare.length > 0) {
      const id = spare.shift()!;
      const [img] = await loadPhotos([id]);
      if (img) {
        photos.push(id);
        break;
      }
    }
  }
  return { ...page, photos, photoLabels: page.photoLabels ? labels : null, spare };
}

export function revokePages(pages: RenderedPage[]): void {
  for (const page of pages) URL.revokeObjectURL(page.url);
}

