'use strict';
/* Jugadores en vivo: detecta quién está transmitiendo ahora en Twitch o YouTube, usando los canales que cada jugador dejó en su perfil.
   Usa las APIs oficiales y necesita claves (variables de entorno):
     TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET   (https://dev.twitch.tv/console)
     YOUTUBE_API_KEY                           (YouTube Data API v3, Google Cloud)
   Sin claves, esa plataforma simplemente no se consulta. El resultado se guarda en memoria unos minutos para no gastar cuota. */

const TW_AUTH = process.env.LIVE_TWITCH_AUTH || 'https://id.twitch.tv';
const TW_API = process.env.LIVE_TWITCH_API || 'https://api.twitch.tv';
const YT_API = process.env.LIVE_YT_API || 'https://www.googleapis.com/youtube/v3';
const TTL = Number(process.env.LIVE_TTL_MS) || 150 * 1000;
const MAX_CHANNELS = 80;

const twitchOn = () => !!(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
const youtubeOn = () => !!process.env.YOUTUBE_API_KEY;

async function getJson(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(8000) }, opts));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* Datos del canal a partir del enlace guardado en el perfil. */
function twitchLogin(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)twitch\.tv$/i.test(u.hostname)) return '';
    const s = u.pathname.split('/').filter(Boolean)[0] || '';
    return /^[A-Za-z0-9_]{2,40}$/.test(s) ? s.toLowerCase() : '';
  } catch (_) { return ''; }
}
function youtubeRef(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'channel' && /^UC[A-Za-z0-9_-]{20,}$/.test(parts[1] || '')) return { id: parts[1] };
    if (parts[0] && parts[0][0] === '@') return { handle: parts[0] };
    if (parts[0] === 'user' && parts[1]) return { username: parts[1] };
    if (parts[0] === 'c' && parts[1]) return { handle: '@' + parts[1] };
    return null;
  } catch (_) { return null; }
}

let twToken = { value: '', exp: 0 };
async function twitchToken() {
  if (twToken.value && Date.now() < twToken.exp - 60000) return twToken.value;
  const body = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID, client_secret: process.env.TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const j = await getJson(TW_AUTH + '/oauth2/token', { method: 'POST', body });
  twToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return twToken.value;
}

async function checkTwitch(entries) {
  const out = new Map();
  if (!twitchOn() || !entries.length) return out;
  const token = await twitchToken();
  const logins = [...new Set(entries.map((e) => e.login))];
  for (let i = 0; i < logins.length; i += 100) {
    const qs = logins.slice(i, i + 100).map((l) => 'user_login=' + encodeURIComponent(l)).join('&');
    const j = await getJson(TW_API + '/helix/streams?first=100&' + qs, { headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: 'Bearer ' + token } });
    for (const s of j.data || []) if (s.type === 'live') out.set(String(s.user_login).toLowerCase(), { title: s.title || '', viewers: s.viewer_count || 0 });
  }
  return out;
}

const ytChannels = new Map(); // clave del canal -> { id, uploads }
async function ytResolve(ref) {
  const key = ref.id || ref.handle || 'u:' + ref.username;
  if (ytChannels.has(key)) return ytChannels.get(key);
  const qs = ref.id ? 'id=' + encodeURIComponent(ref.id) : ref.handle ? 'forHandle=' + encodeURIComponent(ref.handle) : 'forUsername=' + encodeURIComponent(ref.username);
  const j = await getJson(YT_API + '/channels?part=contentDetails&' + qs + '&key=' + encodeURIComponent(process.env.YOUTUBE_API_KEY));
  const c = (j.items || [])[0];
  const val = c ? { id: c.id, uploads: c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads } : null;
  if (val) ytChannels.set(key, val);
  return val;
}

async function checkYoutube(entries) {
  const out = new Map(); // playerId -> { videoId, title, viewers }
  if (!youtubeOn() || !entries.length) return out;
  const key = encodeURIComponent(process.env.YOUTUBE_API_KEY);
  const vidOwner = new Map();
  for (const e of entries) {
    try {
      const ch = await ytResolve(e.ref);
      if (!ch || !ch.uploads) continue;
      const j = await getJson(YT_API + '/playlistItems?part=contentDetails&maxResults=3&playlistId=' + encodeURIComponent(ch.uploads) + '&key=' + key);
      for (const it of j.items || []) vidOwner.set(it.contentDetails.videoId, e.playerId);
    } catch (_) { /* un canal con problemas no debe tumbar a los demás */ }
  }
  const ids = [...vidOwner.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await getJson(YT_API + '/videos?part=snippet,liveStreamingDetails&id=' + ids.slice(i, i + 50).map(encodeURIComponent).join(',') + '&key=' + key);
    for (const v of j.items || []) {
      if (v.snippet && v.snippet.liveBroadcastContent === 'live') {
        const pid = vidOwner.get(v.id);
        if (!out.has(pid)) out.set(pid, { videoId: v.id, title: v.snippet.title || '', viewers: Number(v.liveStreamingDetails && v.liveStreamingDetails.concurrentViewers) || 0 });
      }
    }
  }
  return out;
}

function create(db) {
  const rows = db.prepare("SELECT id, alias, twitch, youtube FROM players WHERE (twitch != '' OR youtube != '') AND active = 1 LIMIT " + MAX_CHANNELS * 2);
  let cache = { at: 0, streams: [] }, inflight = null;

  async function refresh() {
    const players = rows.all();
    const tw = [], yt = [];
    for (const p of players) {
      const login = p.twitch ? twitchLogin(p.twitch) : '';
      if (login) tw.push({ playerId: p.id, alias: p.alias, login });
      const ref = p.youtube ? youtubeRef(p.youtube) : null;
      if (ref) yt.push({ playerId: p.id, alias: p.alias, ref });
    }
    const [twRes, ytRes] = await Promise.all([
      checkTwitch(tw.slice(0, MAX_CHANNELS)).catch(() => new Map()),
      checkYoutube(yt.slice(0, MAX_CHANNELS)).catch(() => new Map()),
    ]);
    const streams = [];
    for (const e of tw) { const s = twRes.get(e.login); if (s) streams.push({ playerId: e.playerId, alias: e.alias, platform: 'twitch', channel: e.login, title: s.title, viewers: s.viewers }); }
    for (const e of yt) { const s = ytRes.get(e.playerId); if (s && !streams.some((x) => x.playerId === e.playerId && x.platform === 'youtube')) streams.push({ playerId: e.playerId, alias: e.alias, platform: 'youtube', videoId: s.videoId, title: s.title, viewers: s.viewers }); }
    streams.sort((a, b) => b.viewers - a.viewers);
    cache = { at: Date.now(), streams };
  }

  return async function getLive() {
    if (Date.now() - cache.at > TTL) {
      if (!inflight) inflight = refresh().catch(() => {}).finally(() => { inflight = null; });
      if (!cache.at) await inflight; // la primera vez se espera; después se responde al tiro con lo último conocido
    }
    return { configured: { twitch: twitchOn(), youtube: youtubeOn() }, updatedAt: cache.at, streams: cache.streams };
  };
}

module.exports = { create, twitchLogin, youtubeRef };
