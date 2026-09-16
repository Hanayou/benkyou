// Generates PWA icons: the 勉 kanji drawn from KanjiVG stroke paths (so no
// CJK font is needed at render time) on a vermillion background.
// Requires public/data to exist (run data:build first).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = join(root, 'public', 'icons');
mkdirSync(iconDir, { recursive: true });

// 勉 = U+52C9 → shard 52.json
const shard = JSON.parse(readFileSync(join(root, 'public', 'data', 'strokes', '52.json'), 'utf8'));
const glyph = shard['52c9'];
if (!glyph) throw new Error('勉 strokes not found — run npm run data:build first');

const BG = '#c8402f';

function makeSvg({ glyphScale }) {
  // KanjiVG viewBox is 109×109; centre and scale the glyph on a 512 canvas.
  const s = (512 * glyphScale) / 109;
  const offset = (512 - 109 * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${s})"
     fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">
    ${glyph.p.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>`;
}

const normal = makeSvg({ glyphScale: 0.74 });
const maskable = makeSvg({ glyphScale: 0.56 });

const jobs = [
  ['icon-192.png', normal, 192],
  ['icon-512.png', normal, 512],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', normal, 180],
];
for (const [name, svg, size] of jobs) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(iconDir, name));
  console.log(`wrote icons/${name}`);
}

writeFileSync(join(root, 'public', 'favicon.svg'), normal);
console.log('wrote favicon.svg');
