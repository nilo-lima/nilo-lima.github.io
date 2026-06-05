/**
 * Sincroniza certificados do Google Drive:
 * - Gera src/data/certificados.json com a lista de grupos e arquivos
 * - Baixa thumbnails para public/certs-thumbnails/ (excluído do git)
 *
 * Requer GDRIVE_CREDENTIALS (JSON da Service Account) e
 * GDRIVE_ROOT_FOLDER_ID (ID da pasta raiz no Drive).
 * A Service Account precisa ter acesso de Leitor à pasta raiz.
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '../src/data/certificados.json');
const THUMB_DIR   = path.join(__dirname, '../public/certs-thumbnails');
const ROOT_FOLDER_ID = process.env.GDRIVE_ROOT_FOLDER_ID || '1DE_Q9HhYitJHtc1xFTTIqsywlBxWLGza';

const FOLDER_LABELS = {
  'DevOps':                      'DevOps',
  'Microsoft':                   'Microsoft',
  'Gestão':                      'Gestão',
  'GPT_AI':                      'IA',
  'Dados':                       'Dados',
  'Dynamics_AX':                 'Dynamics AX',
  'SQL':                         'SQL',
  'Escola_Virtual_Gov_Br':       'Escola Virtual GovBR',
  'Cloud':                       'Cloud',
  'DSA':                         'Data Science Academy',
  'Fundamentals_or_Essentials':  'Fundamentos ou Essencial',
  'Security':                    'Segurança',
  'Python_and_R':                'Python e R',
  'MBAs':                        'MBAs',
  'Academia Forense Digital':    'Academia Forense Digital',
  'BootCamps_XPe':               'Bootcamps XP Educação',
  'PowerBI':                     'Power BI',
  'Linux_e_Redes':               'Linux e Redes',
};

const IGNORED_FOLDERS = new Set(['Certificações', 'Certificacoes', 'Certificações ']);

if (!process.env.GDRIVE_CREDENTIALS) {
  console.warn('⚠️  GDRIVE_CREDENTIALS não definido — sync ignorado. Mantendo arquivos existentes.');
  process.exit(0);
}

const credentials = JSON.parse(process.env.GDRIVE_CREDENTIALS);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

async function listSubfolders(parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    pageSize: 100,
  });
  return res.data.files ?? [];
}

async function listFiles(folderId) {
  const files = [];
  let pageToken = undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'nextPageToken, files(id, name, thumbnailLink)',
      orderBy: 'name',
      pageSize: 200,
      pageToken,
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadThumbnail(fileId, thumbnailLink) {
  const destPath = path.join(THUMB_DIR, `${fileId}.png`);
  if (fs.existsSync(destPath)) return true;

  // Replace Google's default small size (s220) with s400 for better quality
  const url = thumbnailLink.replace(/=s\d+$/, '=s400');
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(destPath, Buffer.from(buffer));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('🔄 Sincronizando certificados do Google Drive...');
  fs.mkdirSync(THUMB_DIR, { recursive: true });

  const folders = await listSubfolders(ROOT_FOLDER_ID);
  const result  = [];

  for (const folder of folders) {
    if (IGNORED_FOLDERS.has(folder.name.trim())) {
      console.log(`  ⏭️  Ignorado: ${folder.name}`);
      continue;
    }

    const label = FOLDER_LABELS[folder.name] ?? folder.name;
    const files = await listFiles(folder.id);
    console.log(`  📁 ${folder.name} → ${label} (${files.length} arquivos)`);
    if (files.length === 0) continue;

    let thumbOk = 0;
    for (const file of files) {
      if (file.thumbnailLink) {
        const ok = await downloadThumbnail(file.id, file.thumbnailLink);
        if (ok) thumbOk++;
      }
    }
    console.log(`     📸 ${thumbOk}/${files.length} thumbnails`);

    result.push({
      folder: folder.name,
      label,
      files: files.map(f => ({
        id: f.id,
        name: f.name.replace(/\.[^.]+$/, ''),
      })),
    });
  }

  result.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2) + '\n');
  const total = result.reduce((n, g) => n + g.files.length, 0);
  console.log(`✅ Concluído — ${result.length} grupos, ${total} certificados.`);
}

main().catch(err => {
  console.error('❌ Falha no sync do Drive:', err.message);
  process.exit(1);
});
