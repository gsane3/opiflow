// Regenerate the web PWA raster icons from the brand-blue SVG sources.
// Run after changing public/icon.svg / public/icon-maskable.svg colour:
//   node scripts/regen-icons.mjs
// Uses sharp (already a Next.js dependency). Renders at high density then
// downsamples for crisp edges.

import sharp from 'sharp';

const DENSITY = 384; // over-render the SVG, then resize down → crisp

const jobs = [
  ['public/icon.svg', 'public/icon-192.png', 192],
  ['public/icon.svg', 'public/icon-512.png', 512],
  ['public/icon.svg', 'public/apple-touch-icon.png', 180],
  ['public/icon-maskable.svg', 'public/icon-maskable-512.png', 512],
];

for (const [src, out, size] of jobs) {
  await sharp(src, { density: DENSITY })
    .resize(size, size, { fit: 'cover' })
    .png()
    .toFile(out);
  console.log('wrote', out, `${size}×${size}`);
}
