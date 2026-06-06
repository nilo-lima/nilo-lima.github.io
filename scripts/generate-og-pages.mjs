import sharp from 'sharp';
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blogDir   = path.join(__dirname, '../src/content/blog');

mkdirSync(path.join(__dirname, '../public/og/pages'),       { recursive: true });
mkdirSync(path.join(__dirname, '../public/og/pages/tags'),  { recursive: true });

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSvg(label, title, subtitle) {
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
  <text x="96" y="118" font-family="monospace" font-size="16" fill="#38BDF8" opacity="0.7" letter-spacing="3">${escapeXml(label)}</text>
  <text x="96" y="292" font-family="sans-serif" font-size="88" font-weight="700" fill="#E2E8F0" letter-spacing="-2">${escapeXml(title)}</text>
  <rect x="96" y="328" width="80"  height="2"   fill="#38BDF8" opacity="0.35"/>
  <text x="96" y="378" font-family="sans-serif" font-size="28" fill="#94A3B8">${escapeXml(subtitle)}</text>
  <text x="96" y="568" font-family="monospace" font-size="15" fill="#38BDF8" opacity="0.45">nilo-lima.github.io</text>
  <text x="1068" y="556" font-family="monospace" font-size="76" fill="#38BDF8" opacity="0.05">♾</text>
  <rect x="0"  y="628" width="1200" height="2"   fill="#38BDF8" opacity="0.15"/>
</svg>`;
}

// ── Páginas estáticas ──────────────────────────────────────────────────
const staticPages = [
  { slug: 'blog',     label: 'CAT: BLOG_INDEX',    title: 'Blog',     subtitle: 'DevOps · Cloud · IA aplicada a infraestrutura' },
  { slug: 'projetos', label: 'CAT: PROJECTS_INDEX', title: 'Projetos', subtitle: 'Infraestrutura reprodutível, automação & IaC'   },
  { slug: 'now',      label: 'CAT: NOW',            title: '/now',     subtitle: 'O que estou trabalhando atualmente'              },
];

for (const page of staticPages) {
  const png = await sharp(Buffer.from(buildSvg(page.label, page.title, page.subtitle))).png().toBuffer();
  writeFileSync(path.join(__dirname, `../public/og/pages/${page.slug}.png`), png);
  console.log(`  ✓ pages/${page.slug}`);
}

// ── Tags (lidas dos posts do blog) ────────────────────────────────────
const tagSlugs = new Map(); // slug → label original

for (const file of readdirSync(blogDir).filter(f => f.endsWith('.md'))) {
  const content = readFileSync(path.join(blogDir, file), 'utf-8');
  if (/^draft:\s*true/m.test(content)) continue;

  let tags = [];
  const inline = content.match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) {
    tags = inline[1].split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  } else {
    const block = content.match(/^tags:\n((?:[ \t]+-[ \t]+.+\n?)+)/m);
    if (block) tags = block[1].split('\n').map(l => l.replace(/^[ \t]+-[ \t]+/, '').trim()).filter(Boolean);
  }

  for (const tag of tags) {
    const slug = tag.toLowerCase().replace(/\s+/g, '-');
    if (!tagSlugs.has(slug)) tagSlugs.set(slug, tag);
  }
}

for (const [slug, label] of tagSlugs) {
  const png = await sharp(Buffer.from(buildSvg('CAT: TAG', `#${label}`, 'Blog · Nilo Lima Jr'))).png().toBuffer();
  writeFileSync(path.join(__dirname, `../public/og/pages/tags/${slug}.png`), png);
  console.log(`  ✓ tags/${slug}`);
}

console.log(`\nOG page images: ${staticPages.length} pages + ${tagSlugs.size} tags → public/og/pages/`);
