import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '../public/og.png');

const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg-glow" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#050505" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="#050505"/>
  <rect width="1200" height="630" fill="url(#bg-glow)"/>

  <!-- Top border accent -->
  <rect x="0" y="0" width="1200" height="2" fill="#38BDF8" opacity="0.6"/>

  <!-- Left vertical accent -->
  <rect x="72" y="60" width="2" height="510" fill="#38BDF8" opacity="0.15"/>

  <!-- Init line -->
  <text x="96" y="108" font-family="monospace" font-size="18" fill="#38BDF8" opacity="0.7" letter-spacing="3">INIT: PORTFOLIO_LOADED</text>

  <!-- Name -->
  <text x="96" y="230" font-family="sans-serif" font-size="72" font-weight="700" fill="#E2E8F0" letter-spacing="-2">Nilo Lima Jr</text>

  <!-- Title line 1 -->
  <text x="96" y="305" font-family="sans-serif" font-size="36" font-weight="600" fill="#94A3B8">Gestor de TI &amp; Especialista</text>

  <!-- Title highlight -->
  <text x="96" y="357" font-family="monospace" font-size="32" font-weight="700" fill="#38BDF8" letter-spacing="1">DevOps · Cloud · IA</text>

  <!-- Divider -->
  <rect x="96" y="400" width="120" height="2" fill="#38BDF8" opacity="0.4"/>

  <!-- Tags -->
  <text x="96" y="455" font-family="monospace" font-size="16" fill="#94A3B8" opacity="0.8">AWS · Azure · GCP · OCI · Kubernetes · Terraform · Ansible</text>

  <!-- URL -->
  <text x="96" y="510" font-family="monospace" font-size="18" fill="#38BDF8" opacity="0.5">nilo-lima.github.io</text>

  <!-- Bottom border -->
  <rect x="0" y="628" width="1200" height="2" fill="#38BDF8" opacity="0.2"/>

  <!-- Corner decoration -->
  <text x="1080" y="540" font-family="monospace" font-size="80" fill="#38BDF8" opacity="0.06">♾</text>
</svg>
`.trim();

const pngBuffer = await sharp(Buffer.from(svg))
  .png()
  .toBuffer();

writeFileSync(outPath, pngBuffer);
console.log(`OG image generated: ${outPath}`);
