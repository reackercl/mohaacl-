'use strict';
/* Respaldo de la base de datos SQLite.
   - Copia consistente con VACUUM INTO (sin detener la página), comprimida con gzip.
   - Se guarda en DATA_DIR/backups (se conservan las últimas BACKUP_KEEP, 14 por defecto).
   - Opcional: se sube también a un almacenamiento externo compatible con S3 (Cloudflare R2, Backblaze B2, AWS S3...).
     Variables: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_KEY_ID, BACKUP_S3_SECRET, (BACKUP_S3_REGION=auto, BACKUP_S3_PREFIX=ladder/)
   - restaurar.js usa restoreIfMissing() al arrancar: si no hay base de datos y existe un respaldo externo, lo recupera.
   Sin dependencias. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');

const dataDir = () => path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const backupDir = () => path.join(dataDir(), 'backups');
const KEEP = () => Math.max(1, Number(process.env.BACKUP_KEEP) || 14);

function s3cfg() {
  const e = process.env;
  if (!e.BACKUP_S3_ENDPOINT || !e.BACKUP_S3_BUCKET || !e.BACKUP_S3_KEY_ID || !e.BACKUP_S3_SECRET) return null;
  return { endpoint: e.BACKUP_S3_ENDPOINT.replace(/\/+$/, ''), bucket: e.BACKUP_S3_BUCKET, id: e.BACKUP_S3_KEY_ID, secret: e.BACKUP_S3_SECRET, region: e.BACKUP_S3_REGION || 'auto', prefix: e.BACKUP_S3_PREFIX || 'ladder/' };
}

const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();

/* Solicitud firmada AWS Signature V4 (estilo ruta: endpoint/bucket/clave) */
async function s3req(cfg, method, key, body) {
  const url = new URL(cfg.endpoint + '/' + cfg.bucket + '/' + key.split('/').map(encodeURIComponent).join('/'));
  const payload = body || Buffer.alloc(0);
  const now = new Date();
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amz.slice(0, 8);
  const ph = sha(payload);
  const headers = { host: url.host, 'x-amz-content-sha256': ph, 'x-amz-date': amz };
  const names = Object.keys(headers).sort();
  const canonical = [method, url.pathname, '', names.map((n) => n + ':' + headers[n] + '\n').join(''), names.join(';'), ph].join('\n');
  const scope = day + '/' + cfg.region + '/s3/aws4_request';
  const sts = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
  const kSign = hmac(hmac(hmac(hmac('AWS4' + cfg.secret, day), cfg.region), 's3'), 'aws4_request');
  const auth = 'AWS4-HMAC-SHA256 Credential=' + cfg.id + '/' + scope + ', SignedHeaders=' + names.join(';') + ', Signature=' + hmac(kSign, sts).toString('hex');
  const r = await fetch(url, { method, headers: Object.assign({}, headers, { authorization: auth }), body: method === 'PUT' ? payload : undefined, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('S3 ' + method + ' ' + r.status);
  return method === 'GET' ? Buffer.from(await r.arrayBuffer()) : null;
}

function listLocal() {
  try {
    return fs.readdirSync(backupDir()).filter((f) => /^ladder-[0-9T-]+\.sqlite\.gz$/.test(f)).sort().reverse().map((f) => {
      const st = fs.statSync(path.join(backupDir(), f));
      return { file: f, size: st.size, at: st.mtimeMs };
    });
  } catch (_) { return []; }
}

let running = null;
/* Crea un respaldo ahora. Devuelve { file, size, uploaded, error? } */
function backupNow(db) {
  if (running) return running;
  running = (async () => {
    fs.mkdirSync(backupDir(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const raw = path.join(backupDir(), 'ladder-' + stamp + '.sqlite');
    const gz = raw + '.gz';
    try { fs.unlinkSync(raw); } catch (_) {}
    db.exec("VACUUM INTO '" + raw.replace(/'/g, "''") + "'");
    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 6 }), fs.createWriteStream(gz));
    fs.unlinkSync(raw);
    for (const old of listLocal().slice(KEEP())) { try { fs.unlinkSync(path.join(backupDir(), old.file)); } catch (_) {} }
    const out = { file: path.basename(gz), size: fs.statSync(gz).size, uploaded: false };
    const cfg = s3cfg();
    if (cfg) {
      try {
        const data = fs.readFileSync(gz);
        await s3req(cfg, 'PUT', cfg.prefix + path.basename(gz), data);
        await s3req(cfg, 'PUT', cfg.prefix + 'ladder-latest.sqlite.gz', data);
        out.uploaded = true;
      } catch (e) { out.error = 'No se pudo subir al almacenamiento externo: ' + e.message; }
    }
    return out;
  })().finally(() => { running = null; });
  return running;
}

/* Si no existe la base de datos y hay respaldo externo, lo recupera. Se usa antes de arrancar el servidor. */
async function restoreIfMissing() {
  const dbFile = path.join(dataDir(), 'ladder.db');
  if (fs.existsSync(dbFile)) return 'ya-existe';
  const cfg = s3cfg();
  const allowNew = process.env.ALLOW_EMPTY_DB === '1';
  if (!cfg) {
    if (allowNew) return 'base-nueva-autorizada';
    throw new Error('No existe ladder.db ni un respaldo externo. Para iniciar una instalación nueva, configura temporalmente ALLOW_EMPTY_DB=1.');
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  let gz;
  try { gz = await s3req(cfg, 'GET', cfg.prefix + 'ladder-latest.sqlite.gz'); }
  catch (e) {
    if (allowNew && e.message === 'S3 GET 404') return 'base-nueva-autorizada';
    throw new Error('No se pudo recuperar el respaldo externo: ' + e.message);
  }
  const restored = zlib.gunzipSync(gz);
  // Un respaldo corrupto no debe convertirse en una base de datos vacía.
  if (restored.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('El respaldo no contiene una base SQLite válida.');
  // Cada intento usa un nombre nuevo: un temporal abandonado no bloquea el siguiente arranque.
  const temporary = path.join(dataDir(), '.ladder-restore-' + process.pid + '-' + crypto.randomBytes(8).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temporary, restored, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, dbFile);
  } finally {
    // Si una escritura o el rename fallan, no dejamos un temporal de este intento.
    try { fs.unlinkSync(temporary); }
    catch (e) {
      if (e.code !== 'ENOENT') console.error('No se pudo limpiar el temporal de restauración:', e.message);
    }
  }
  return 'restaurada';
}

function start(db) {
  const hours = Math.max(0.1, Number(process.env.BACKUP_EVERY_HOURS) || 24);
  const run = () => backupNow(db).then((r) => console.log('Respaldo listo:', r.file, r.uploaded ? '(subido)' : '', r.error || ''), (e) => console.error('Respaldo falló:', e.message));
  // Primer respaldo poco después de arrancar si el último es más viejo que el intervalo
  setTimeout(() => { const l = listLocal()[0]; if (!l || Date.now() - l.at > hours * 3600 * 1000) run(); }, 2 * 60 * 1000).unref();
  setInterval(run, hours * 3600 * 1000).unref();
}

module.exports = { backupNow, listLocal, restoreIfMissing, start, backupDir, s3cfg };
