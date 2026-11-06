'use strict';
/* Servers online: consulta por UDP los servidores de MOHAA que el administrador agregó (nombre + IP:puerto)
   y devuelve mapa, jugadores y estado. Sin dependencias (node:dgram).
   Protocolos probados en paralelo (el primero que responda gana):
     - GameSpy "\status\" al puerto de consulta (puerto de juego + 97; 12203 -> 12300), el de Allied Assault original.
     - Quake 3 "getstatus" (OOB) al puerto de juego, el que usa OpenMOHAA.
   El resultado se guarda en memoria 45 s para no consultar en cada visita. */
const dgram = require('node:dgram');
const dns = require('node:dns').promises;

const TTL = Number(process.env.SERVERS_TTL_MS) || 45 * 1000;
const TIMEOUT = Number(process.env.SERVERS_TIMEOUT_MS) || 2500;
const DEFAULT_PORT = 12203;
const MAX_SERVERS = 40;

const isPrivate = (ip) => /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|2[3-5]\d\.)/.test(ip) || ip === '::1';

/* "1.2.3.4", "1.2.3.4:12203" o "mi.host.cl:12203" -> { host, port } o null */
function parseAddr(s) {
  s = String(s || '').trim().slice(0, 120);
  const m = s.match(/^([A-Za-z0-9.-]{1,100}?)(?::(\d{2,5}))?$/);
  if (!m) return null;
  const port = m[2] ? parseInt(m[2], 10) : DEFAULT_PORT;
  if (port < 1 || port > 65535) return null;
  if (!/[A-Za-z0-9]/.test(m[1]) || m[1].startsWith('.') || m[1].endsWith('.')) return null;
  return { host: m[1], port };
}

function clr(s) { return String(s == null ? '' : s).replace(/\^[0-9a-zA-Z]/g, '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 80); }

function parseKV(text) {
  const parts = text.split('\\');
  if (parts[0] === '') parts.shift();
  const kv = {};
  for (let i = 0; i + 1 < parts.length; i += 2) kv[parts[i].toLowerCase()] = parts[i + 1];
  return kv;
}

function finish(kv, players) {
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
  return {
    online: true,
    hostname: clr(kv.hostname || kv.sv_hostname),
    map: clr(kv.mapname),
    gametype: clr(kv.gametype || kv.g_gametype),
    players: Math.min(num(kv.numplayers) || players.length, 128),
    max: num(kv.maxplayers || kv.sv_maxclients),
    list: players.slice(0, 64),
  };
}

/* GameSpy: \hostname\X\mapname\Y\numplayers\N\player_0\Nombre\score_0\5\ping_0\40...\final\ (puede venir en varios paquetes) */
function parseGamespy(text) {
  const kv = parseKV(text);
  const players = [];
  for (let i = 0; kv['player_' + i] !== undefined || kv['playername_' + i] !== undefined; i++) {
    players.push({ name: clr(kv['player_' + i] !== undefined ? kv['player_' + i] : kv['playername_' + i]), score: parseInt(kv['score_' + i], 10) || 0, ping: parseInt(kv['ping_' + i], 10) || 0 });
  }
  return { kv, players };
}

/* Quake 3: ÿÿÿÿstatusResponse\n\k\v\k\v...\n<score> <ping> "nombre"\n... */
function parseQ3(text) {
  const lines = text.split('\n');
  const kv = parseKV(lines[1] || '');
  const players = [];
  for (const ln of lines.slice(2)) {
    const m = ln.match(/^(-?\d+)\s+(-?\d+)\s+"(.*)"$/);
    if (m) players.push({ name: clr(m[3]), score: +m[1], ping: +m[2] });
  }
  return { kv, players };
}

function udpQuery(ip, port, payload, parse, ready) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket(ip.includes(':') ? 'udp6' : 'udp4');
    let buf = '', done = false;
    const end = (v) => { if (done) return; done = true; clearTimeout(t); try { sock.close(); } catch (_) {} resolve(v); };
    const t = setTimeout(() => end(buf ? parse(buf) : null), TIMEOUT);
    sock.on('error', () => end(null));
    sock.on('message', (m) => {
      buf += m.toString('latin1');
      if (ready(buf)) end(parse(buf));
    });
    sock.send(Buffer.from(payload, 'latin1'), port, ip, (e) => { if (e) end(null); });
  });
}

async function queryOne(entry) {
  const base = { name: entry.name, address: entry.host + ':' + entry.port };
  let ip;
  try {
    ip = /^[0-9.]+$/.test(entry.host) || entry.host.includes(':') ? entry.host : (await dns.lookup(entry.host)).address;
  } catch (_) { return Object.assign(base, { online: false }); }
  if (isPrivate(ip) && !process.env.SERVERS_ALLOW_PRIVATE) return Object.assign(base, { online: false, note: 'IP privada' });
  const gs = udpQuery(ip, entry.port + 97, '\\status\\', parseGamespy, (b) => /\\final\\/.test(b)).then((r) => r && r.kv.mapname !== undefined ? r : null);
  const q3 = udpQuery(ip, entry.port, '\xff\xff\xff\xffgetstatus\n', parseQ3, () => true).then((r) => r && r.kv.mapname !== undefined ? r : null);
  const r = await new Promise((resolve) => {
    let left = 2;
    for (const p of [gs, q3]) p.then((v) => { if (v) resolve(v); else if (--left === 0) resolve(null); });
  });
  if (!r) return Object.assign(base, { online: false });
  return Object.assign(base, finish(r.kv, r.players));
}

function create(db) {
  db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const get = () => {
    try { const r = db.prepare("SELECT value FROM config WHERE key='servers'").get(); const l = r ? JSON.parse(r.value) : [{ name: 'Servidor de prueba', host: '34.0.56.25', port: 14003 }]; return Array.isArray(l) ? l : []; } catch (_) { return []; }
  };
  let cache = { at: 0, key: '', data: null }, pending = null;
  async function list() {
    const entries = get();
    const key = JSON.stringify(entries);
    if (cache.data && cache.key === key && Date.now() - cache.at < TTL) return cache.data;
    if (pending && cache.key === key) return pending;
    cache.key = key;
    pending = Promise.all(entries.map(queryOne)).then((servers) => {
      cache = { at: Date.now(), key, data: { servers, at: Date.now() } };
      pending = null; return cache.data;
    }, () => { pending = null; return { servers: [], at: Date.now() }; });
    return pending;
  }
  function save(items) {
    const out = [], seen = new Set();
    for (const it of Array.isArray(items) ? items : []) {
      const a = parseAddr(it && it.address);
      const name = clr(it && it.name);
      if (!a || !name) return { error: 'Revisa "' + clr(it && it.name) + '": necesita nombre y una IP válida (ej. 200.1.2.3:12203).' };
      const k = a.host.toLowerCase() + ':' + a.port;
      if (seen.has(k)) continue;
      seen.add(k); out.push({ name, host: a.host, port: a.port });
    }
    if (out.length > MAX_SERVERS) return { error: 'Máximo ' + MAX_SERVERS + ' servidores.' };
    db.prepare("INSERT INTO config(key,value) VALUES('servers',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(out));
    cache = { at: 0, key: '', data: null };
    return { ok: true, servers: out };
  }
  return { list, get, save };
}

module.exports = { create, parseAddr, parseGamespy, parseQ3 };
