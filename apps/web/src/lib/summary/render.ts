import { PALETTES, readyFonts } from './canvas';
import { buildPages, templateForPage } from './data';
import { TEMPLATES } from './templates';
import { FORMATS, type PageData, type SummarySource, type SummarySpec } from './types';

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
): Promise<{ pages: RenderedPage[]; data: PageData[] }> {
  await readyFonts();
  const data = await buildPages(source, spec);
  const format = FORMATS[spec.format];
  const out: RenderedPage[] = [];

  for (let i = 0; i < data.length; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = format.width;
    canvas.height = format.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Deze browser kan geen afbeeldingen tekenen');

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
    if (!blob) throw new Error('Renderen mislukt');
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

export function revokePages(pages: RenderedPage[]): void {
  for (const page of pages) URL.revokeObjectURL(page.url);
}

