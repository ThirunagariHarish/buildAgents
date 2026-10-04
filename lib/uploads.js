// Files attached to ideas and steer messages. Stored under data/uploads as
// <id>.<ext> plus <id>.json metadata, and handed to agents as content blocks.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(DIR, { recursive: true });

const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv', 'application/json': 'json',
};
// What the Claude CLI can take as a content block; anything else is inlined as text.
const BLOCK_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);
const MAX_BLOCKS = 8;
const MAX_TEXT_CHARS = 40000;

function kindOf(type) {
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  return 'text';
}

function normaliseType(type, name) {
  type = String(type || '').split(';')[0].trim().toLowerCase();
  if (TYPES[type]) return type;
  const ext = path.extname(name || '').slice(1).toLowerCase();
  const byExt = Object.entries(TYPES).find(([, e]) => e === ext || (ext === 'jpeg' && e === 'jpg') || (ext === 'markdown' && e === 'md'));
  return byExt ? byExt[0] : null;
}

/** Stream a request body to disk. Resolves to the saved file's metadata. */
function saveUpload(req, { name, type }) {
  return new Promise((resolve, reject) => {
    const mime = normaliseType(type, name);
    if (!mime) return reject(new Error('Unsupported file type. Attach images, PDFs, or text files (txt, md, csv, json).'));
    const id = crypto.randomBytes(8).toString('hex');
    const file = path.join(DIR, `${id}.${TYPES[mime]}`);
    const out = fs.createWriteStream(file);
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(file, { force: true }, () => {});
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { req.destroy(); fail(new Error('File is larger than 15 MB.')); }
    });
    req.on('error', fail);
    out.on('error', fail);
    req.pipe(out);
    out.on('finish', () => {
      if (failed) return;
      if (!size) return fail(new Error('The file is empty.'));
      const meta = {
        id, name: String(name || 'file').slice(0, 120), type: mime, kind: kindOf(mime),
        size, file: path.basename(file), createdAt: Date.now(),
      };
      fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(meta));
      resolve(publicMeta(meta));
    });
  });
}

function getUpload(id) {
  if (!/^[a-f0-9]{16}$/.test(String(id))) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    return { meta, path: path.join(DIR, meta.file) };
  } catch {
    return null;
  }
}

function publicMeta(m) {
  return { id: m.id, name: m.name, type: m.type, kind: m.kind, size: m.size };
}

/** Keep only ids that exist; returns their public metadata. */
function resolveIds(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => getUpload(id))
    .filter(Boolean)
    .map((u) => publicMeta(u.meta))
    .slice(0, 10);
}

/**
 * Turn attachment metadata into what an agent call needs: content blocks for
 * images/PDFs (newest last, capped) and a text section for text files.
 */
function forClaude(attachments) {
  const blocks = [];
  let text = '';
  const media = attachments.filter((a) => BLOCK_TYPES.has(a.type)).slice(-MAX_BLOCKS);
  for (const a of media) {
    const u = getUpload(a.id);
    if (!u) continue;
    const data = fs.readFileSync(u.path).toString('base64');
    blocks.push(a.kind === 'pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: a.type, data } });
  }
  for (const a of attachments.filter((x) => !BLOCK_TYPES.has(x.type))) {
    const u = getUpload(a.id);
    if (!u) continue;
    const body = fs.readFileSync(u.path, 'utf8').slice(0, MAX_TEXT_CHARS);
    text += `\n--- ATTACHED FILE: ${a.name} ---\n${body}\n`;
  }
  return { blocks, text, mediaNames: media.map((a) => a.name) };
}

function removeUploads(attachments) {
  for (const a of attachments || []) {
    const u = getUpload(a.id);
    if (!u) continue;
    fs.rm(u.path, { force: true }, () => {});
    fs.rm(path.join(DIR, `${a.id}.json`), { force: true }, () => {});
  }
}

/** Store a file Box itself produced (e.g. a prototype), bypassing the user upload type list. */
function saveGenerated({ name, type, content }) {
  const ext = { 'text/html': 'html', 'text/markdown': 'md', 'text/plain': 'txt', 'application/json': 'json', 'image/svg+xml': 'svg' }[type];
  if (!ext) throw new Error(`unsupported generated type ${type}`);
  const id = crypto.randomBytes(8).toString('hex');
  const file = `${id}.${ext}`;
  fs.writeFileSync(path.join(DIR, file), content);
  const meta = { id, name, type, kind: ext === 'html' ? 'html' : ext === 'svg' ? 'image' : 'text', size: Buffer.byteLength(content), file, createdAt: Date.now(), generated: true };
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(meta));
  return publicMeta(meta);
}

/** Import a file the crew wrote (e.g. a QA screenshot) into the uploads store. */
function importFile(srcPath, { name }) {
  const ext = path.extname(srcPath).slice(1).toLowerCase();
  const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', html: 'text/html' }[ext];
  if (!type) return null;
  const st = fs.statSync(srcPath);
  if (st.size > MAX_BYTES) return null;
  const id = crypto.randomBytes(8).toString('hex');
  const file = `${id}.${ext === 'jpeg' ? 'jpg' : ext}`;
  fs.copyFileSync(srcPath, path.join(DIR, file));
  const meta = { id, name: name || path.basename(srcPath), type, kind: ext === 'html' ? 'html' : kindOf(type), size: st.size, file, createdAt: Date.now(), generated: true };
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(meta));
  return publicMeta(meta);
}

module.exports = { saveUpload, getUpload, resolveIds, forClaude, removeUploads, saveGenerated, importFile, MAX_BYTES };
