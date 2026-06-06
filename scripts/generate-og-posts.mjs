import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blogDir  = path.join(__dirname, '../src/content/blog');
const outDir   = path.join(__dirname, '../public/og/posts');

mkdirSync(outDir, { recursive: true });

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    fm[key] = val;
  }
  return fm;
}

function parseTagsFromContent(content) {
  // Inline array: tags: [a, b, c]
  const inline = content.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  // Block array:
  //   tags:
  //     - a
  const block = content.match(/^tags:\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
  if (block) {
    return block[1].split('\n').map(l => l.replace(/^[ \t]+-[ \t]+/, '').trim()).filter(Boolean);
  }
  return [];
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildSvg(title, dateStr, tags) {
  const rawLines = wrapText(title, 38);
  const MAX_LINES = 3;
  const lines = rawLines.slice(0, MAX_LINES);
  if (rawLines.length > MAX_LINES) {
    lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/.{2}$/, '…');
  }

  const TITLE_Y  = 250;
  const LINE_H   = 70;
  const titleSvg = lines
    .map((l, i) =>
      `<text x="96" y="${TITLE_Y + i * LINE_H}" font-family="sans-serif" font-size="58" font-weight="700" fill="#E2E8F0" letter-spacing="-1">${escapeXml(l)}</text>`
    )
    .join('\n  ');

  const dividerY  = TITLE_Y + lines.length * LINE_H + 30;
  const tagsStr   = tags.slice(0, 4).map(t => `#${t}`).join(' · ');

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#050505" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#050505"/>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="0"  y="0"   width="1200" height="2"   fill="#38BDF8" opacity="0.6"/>
  <rect x="72" y="60"  width="2"    height="510" fill="#38BDF8" opacity="0.12"/>
  <text x="96" y="108" font-family="monospace" font-size="15" fill="#38BDF8" opacity="0.7" letter-spacing="3">CAT: BLOG_POST</text>
  <text x="96" y="144" font-family="monospace" font-size="13" fill="#94A3B8" opacity="0.6" letter-spacing="2">${escapeXml(dateStr)}</text>
  ${titleSvg}
  <rect x="96" y="${dividerY}"    width="80" height="2"  fill="#38BDF8" opacity="0.35"/>
  <text x="96" y="${dividerY + 38}" font-family="monospace" font-size="13" fill="#94A3B8" opacity="0.65">${escapeXml(tagsStr)}</text>
  <text x="96" y="584" font-family="monospace" font-size="15" fill="#38BDF8" opacity="0.45">nilo-lima.github.io</text>
  <text x="1068" y="566" font-family="monospace" font-size="76" fill="#38BDF8" opacity="0.05">♾</text>
  <rect x="0"  y="628" width="1200" height="2"   fill="#38BDF8" opacity="0.15"/>
</svg>`;
}

const files = readdirSync(blogDir).filter(f => f.endsWith('.md'));
let count = 0;

for (const file of files) {
  const content = readFileSync(path.join(blogDir, file), 'utf-8');
  const fm = parseFrontmatter(content);
  if (!fm.title || fm.draft === 'true') continue;

  const slug = file.replace(/\.md$/, '');

  const dateStr = fm.pubDate
    ? new Date(fm.pubDate).toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
      })
    : '';

  const tags = parseTagsFromContent(content);
  const svg  = buildSvg(fm.title, dateStr, tags);

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(path.join(outDir, `${slug}.png`), pngBuffer);
  count++;
  console.log(`  ✓ ${slug}`);
}

console.log(`\nOG post images: ${count} → public/og/posts/`);
