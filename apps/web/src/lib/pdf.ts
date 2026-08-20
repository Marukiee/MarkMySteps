/**
 * A very small PDF writer: pages that are each one JPEG.
 *
 * The photo book's pages are drawn on canvas, exactly like the posters, so
 * everything that needs to end up in the file is already a picture. A JPEG can
 * be embedded in a PDF byte for byte (DCTDecode), which means no library, no
 * re-encoding, and a file the size of the pictures in it.
 */

export interface PdfPage {
  jpeg: ArrayBuffer;
  /** Pixel size of the image; the page is made to match at 150 dpi. */
  width: number;
  height: number;
}

/** PDF units are 1/72 inch; pages are rendered at 150 dpi. */
const DPI = 150;

export function buildPdf(pages: PdfPage[], title: string): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  /** Every object's byte offset, which is what the xref table is. */
  const startObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  push('%PDF-1.4\n');
  // A comment with high bytes marks the file as binary for anything that
  // still cares (and for tools that would otherwise mangle line endings).
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1: catalog, 2: page tree, then three objects per page.
  const pageIds = pages.map((_, i) => 3 + i * 3);
  const infoId = 3 + pages.length * 3;

  startObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObject(2);
  push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds
      .map((id) => `${id} 0 R`)
      .join(' ')}] >>\nendobj\n`,
  );

  pages.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const imageId = pageId + 1;
    const contentId = pageId + 2;
    const w = (page.width / DPI) * 72;
    const h = (page.height / DPI) * 72;

    startObject(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );

    startObject(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.byteLength} >>\nstream\n`,
    );
    push(new Uint8Array(page.jpeg));
    push('\nendstream\nendobj\n');

    // The image fills the page: scale to the media box, draw at the origin.
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Im0 Do Q\n`;
    startObject(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  });

  startObject(infoId);
  push(`<< /Title (${escapePdfText(title)}) /Producer (MarkMySteps) >>\nendobj\n`);

  const xrefAt = length;
  const count = infoId + 1;
  push(`xref\n0 ${count}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id < count; id++) {
    push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/** Parentheses and backslashes end a PDF string early if left as they are. */
function escapePdfText(text: string): string {
  return text.replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7e]/g, '');
}
