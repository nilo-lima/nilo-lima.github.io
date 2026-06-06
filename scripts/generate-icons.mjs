import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../public');

function makeSvg(size) {
  const center = size / 2;
  const fontSize = Math.round(size * 0.52);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#050505" rx="${Math.round(size * 0.18)}"/>
  <rect x="0" y="0" width="${size}" height="${Math.round(size * 0.018)}" fill="#38BDF8" opacity="0.7"/>
  <text
    x="${center}" y="${Math.round(center + fontSize * 0.35)}"
    font-family="sans-serif" font-size="${fontSize}"
    text-anchor="middle" fill="#38BDF8"
  >♾</text>
</svg>`;
}

for (const size of [192, 512]) {
  const png = await sharp(Buffer.from(makeSvg(size))).png().toBuffer();
  writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`  ✓ icon-${size}.png`);
}

console.log('PWA icons → public/');
