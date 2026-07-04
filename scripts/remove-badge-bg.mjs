// Remove o fundo sólido (preto ou branco) de badges Oracle exportadas sem transparência.
// Uso: node scripts/remove-badge-bg.mjs <entrada.jpg> <saida.png> [tolerancia=40]
//
// A Oracle exporta os badges do catalog-education.oracle.com como JPG com fundo
// preto embutido (perdeu o alpha na conversão) e as trilhas do mylearn.oracle.com
// às vezes vêm com fundo branco. O script faz flood fill a partir dos 4 cantos da
// imagem — só remove a região do fundo conectada às bordas, preservando qualquer
// elemento escuro/claro que esteja dentro da arte (texto, sombras, etc.).
import sharp from "sharp";

const [, , inputPath, outputPath, toleranceArg] = process.argv;

if (!inputPath || !outputPath) {
  console.error("Uso: node scripts/remove-badge-bg.mjs <entrada> <saida.png> [tolerancia=40]");
  process.exit(1);
}

const tolerance = toleranceArg ? Number(toleranceArg) : 40;

const image = sharp(inputPath).ensureAlpha();
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info; // channels = 4 (RGBA)

const idx = (x, y) => (y * width + x) * channels;
const seedIdx = idx(0, 0);
const seed = [data[seedIdx], data[seedIdx + 1], data[seedIdx + 2]];

const visited = new Uint8Array(width * height);
const stack = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
for (const [x, y] of stack) visited[y * width + x] = 1;

while (stack.length) {
  const [x, y] = stack.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const flat = ny * width + nx;
    if (visited[flat]) continue;
    const p = idx(nx, ny);
    const diff = Math.abs(data[p] - seed[0]) + Math.abs(data[p + 1] - seed[1]) + Math.abs(data[p + 2] - seed[2]);
    if (diff <= tolerance) {
      visited[flat] = 1;
      stack.push([nx, ny]);
    }
  }
}

for (let p = 0; p < width * height; p++) {
  if (visited[p]) data[p * channels + 3] = 0;
}

// compressionLevel apenas (sem palette:true — quantização degrada texto anti-aliased em fundo escuro)
await sharp(data, { raw: { width, height, channels } })
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

const removedPct = ((visited.reduce((a, b) => a + b, 0) / (width * height)) * 100).toFixed(1);
console.log(`${inputPath} -> ${outputPath} (fundo removido: ${removedPct}%, seed=${seed})`);
