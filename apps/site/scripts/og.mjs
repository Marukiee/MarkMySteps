// Draws public/og.png, the picture a link to the site shows in WhatsApp and
// on social media: the paper, the compass, the headline and a real screenshot.
//   node scripts/og.mjs
// Uses the fonts the computer has (Georgia stands in for Fraunces), so run it
// on a Mac and commit the result.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const W = 1200;
const H = 630;

const phoneW = 300;
const phoneH = Math.round((phoneW * 2868) / 1320);
const screen = await sharp(here('../src/assets/shots/nl/hero.jpg'))
  .resize(phoneW - 16, phoneH - 16)
  .composite([
    {
      input: Buffer.from(
        `<svg width="${phoneW - 16}" height="${phoneH - 16}"><rect width="100%" height="100%" rx="34" fill="#fff"/></svg>`,
      ),
      blend: 'dest-in',
    },
  ])
  .png()
  .toBuffer();
// The phone runs off the bottom edge, as if it stands in front of the card.
const visible = await sharp(screen).extract({ left: 0, top: 0, width: phoneW - 16, height: H - 78 }).toBuffer();

const art = `
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="78%" cy="62%" r="45%">
      <stop offset="0" stop-color="#fbe9e2"/>
      <stop offset="1" stop-color="#faf6ef"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <circle cx="930" cy="400" r="250" fill="#f1ebe1"/>
  <g transform="translate(72 70) scale(2.2)" fill="none" stroke="#e8613c" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9.4"/>
    <path d="m16.4 7.6-2.5 6.3-6.3 2.5 2.5-6.3Z"/>
  </g>
  <text x="140" y="112" font-family="Helvetica Neue, Helvetica, Arial" font-weight="700" font-size="36" fill="#1e2a35">MarkMySteps</text>
  <text x="72" y="300" font-family="Georgia, serif" font-weight="700" font-size="74" fill="#1e2a35">Je reis, vanzelf</text>
  <text x="72" y="384" font-family="Georgia, serif" font-weight="700" font-size="74" fill="#1e2a35">op de kaart.</text>
  <text x="74" y="460" font-family="Helvetica Neue, Helvetica, Arial" font-size="27" fill="#51616f">Route, foto’s en reisgenoten op één kaart.</text>
  <text x="74" y="500" font-family="Helvetica Neue, Helvetica, Arial" font-size="27" fill="#51616f">Voor iPhone en Android, zonder Google.</text>
  <rect x="${880 - phoneW / 2}" y="70" width="${phoneW}" height="${phoneH}" rx="42" fill="#12161b"/>
</svg>`;

await sharp(Buffer.from(art))
  .composite([{ input: visible, left: 880 - phoneW / 2 + 8, top: 78 }])
  .png({ compressionLevel: 9 })
  .toFile(here('../public/og.png'));

console.log('public/og.png written');
