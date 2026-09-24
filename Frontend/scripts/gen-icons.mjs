/* eslint-disable no-console */
// Generates PWA PNG icons from public/logo.svg (placeholder brand art).
// Usage: npm run icons
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = await readFile(new URL('../public/logo.svg', import.meta.url));
const BG = '#0B0C0F';

async function icon(size, padding, file) {
  const inner = Math.round(size * (1 - padding * 2));
  const mark = await sharp(svg, { density: 512 }).resize(inner, inner).png().toBuffer();
  const out = await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
  await writeFile(new URL(`../public/icons/${file}`, import.meta.url), out);
  console.log('wrote', file);
}

await icon(192, 0.12, 'icon-192.png');
await icon(512, 0.12, 'icon-512.png');
await icon(512, 0.22, 'maskable-512.png'); // safe zone for maskable
await icon(180, 0.12, 'apple-touch-icon.png');
await icon(32, 0.06, 'favicon-32.png');
