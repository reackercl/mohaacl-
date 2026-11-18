'use strict';
/*
 * Ladder Freeze Tag: servidor de cuentas.
 * Sin dependencias externas. Requiere Node 22.13 o superior.
 *
 * Variables de entorno (todas opcionales):
 *   PORT          puerto de escucha (por defecto 3000)
 *   DATA_DIR      carpeta donde se guarda la base de datos (por defecto ./data)
 *   TRUST_PROXY   "1" si el sitio está detrás de un proxy o balanceador (Render, Railway, Nginx...).
 *                 Así se lee la IP real del visitante y se detecta HTTPS.
 *   COOKIE_SECURE "1" para forzar cookies solo por HTTPS
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const FORCE_SECURE = process.env.COOKIE_SECURE === '1';

const DAY = 24 * 60 * 60 * 1000;
const SESSION_REMEMBER_MS = 30 * DAY;
const SESSION_SHORT_MS = 12 * 60 * 60 * 1000;

/* ---------- Base de datos ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'ladder.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    alias      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash  TEXT NOT NULL,
    icq        TEXT NOT NULL DEFAULT '',
    aim        TEXT NOT NULL DEFAULT '',
    msn        TEXT NOT NULL DEFAULT '',
    website    TEXT NOT NULL DEFAULT '',
    logo       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    verified   INTEGER NOT NULL DEFAULT 1,
    code_hash  TEXT NOT NULL DEFAULT '',
    code_exp   INTEGER NOT NULL DEFAULT 0,
    code_tries INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS clans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    tag        TEXT NOT NULL DEFAULT '',
    website    TEXT NOT NULL DEFAULT '',
    logo       TEXT NOT NULL DEFAULT '',
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    streak     INTEGER NOT NULL DEFAULT 0,
    last_match INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS clan_members (
    clan_id   INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (clan_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    winner_id   INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    loser_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    resolved_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS matches_status ON matches(status, resolved_at);
  CREATE TABLE IF NOT EXISTS match_players (
    match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    side      TEXT NOT NULL,
    PRIMARY KEY (match_id, player_id)
  );
  CREATE TABLE IF NOT EXISTS clan_invites (
    clan_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (clan_id, player_id)
  );
`);

// Bases creadas antes de existir la validación: agregar columnas (esas cuentas quedan validadas).
{
  const cols = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  for (const [n, def] of [['verified', 'INTEGER NOT NULL DEFAULT 1'], ['code_hash', "TEXT NOT NULL DEFAULT ''"], ['code_exp', 'INTEGER NOT NULL DEFAULT 0'], ['code_tries', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.includes(n)) db.exec('ALTER TABLE players ADD COLUMN ' + n + ' ' + def);
  }
}

{
  const cols = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
  const clanCols = db.prepare('PRAGMA table_info(clans)').all().map((c) => c.name);
  for (const n of ['cur_rank', 'last_rank', 'best_rank', 'worst_rank', 'trend']) {
    if (!clanCols.includes(n)) db.exec('ALTER TABLE clans ADD COLUMN ' + n + ' INTEGER NOT NULL DEFAULT 0');
  }
  for (const [n, def] of [['report_comment', "TEXT NOT NULL DEFAULT ''"], ['confirm_comment', "TEXT NOT NULL DEFAULT ''"], ['confirmer_id', 'INTEGER NOT NULL DEFAULT 0'], ['loss_applied', 'INTEGER NOT NULL DEFAULT 0'], ['prev_streak', 'INTEGER NOT NULL DEFAULT 0'], ['prev_last', 'INTEGER NOT NULL DEFAULT 0'], ['set_streak', 'INTEGER NOT NULL DEFAULT 0'], ['season_id', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.includes(n)) db.exec('ALTER TABLE matches ADD COLUMN ' + n + ' ' + def);
  }
}
const MAX_CLAN_MEMBERS = 12;
const MAX_CLAN_INVITES = 20;
// Permisos por rango: Líder todo; Colíder reclutar + reportar/confirmar; Capitán solo reportar/confirmar
const CAN_EDIT = ['leader'], CAN_RECRUIT = ['leader', 'coleader'], CAN_MATCH = ['leader', 'coleader', 'captain'];
db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    stage     TEXT NOT NULL DEFAULT '',
    starts_at INTEGER NOT NULL,
    ends_at   INTEGER NOT NULL DEFAULT 0,
    status    TEXT NOT NULL DEFAULT 'active',
    closed_at INTEGER NOT NULL DEFAULT 0,
    closed_by TEXT NOT NULL DEFAULT '',
    origin    TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS season_results (
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    rank      INTEGER NOT NULL,
    clan_id   INTEGER NOT NULL,
    clan_name TEXT NOT NULL,
    wins      INTEGER NOT NULL DEFAULT 0,
    losses    INTEGER NOT NULL DEFAULT 0,
    streak    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (season_id, rank)
  );
  CREATE INDEX IF NOT EXISTS season_results_clan ON season_results(clan_id);
`);
// Bases anteriores a las temporadas: todo lo ya jugado pasa a una primera temporada activa.
if (!db.prepare('SELECT COUNT(*) AS n FROM seasons').get().n && db.prepare('SELECT COUNT(*) AS n FROM clans').get().n) {
  const sid = Number(db.prepare("INSERT INTO seasons (name, stage, starts_at) VALUES ('Objetivo ' || strftime('%Y', 'now'), 'Etapa I', ?)").run(Date.now()).lastInsertRowid);
  db.prepare('UPDATE matches SET season_id = ? WHERE season_id = 0').run(sid);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'noticia',
    event_at INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1,
    pinned INTEGER NOT NULL DEFAULT 0,
    author_id INTEGER NOT NULL DEFAULT 0,
    author TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_news_pub ON news (published, pinned, created_at);
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, url TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'juego',
    description TEXT NOT NULL DEFAULT '', info TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS site_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, url TEXT NOT NULL, image TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
`);
const DL_CATS = { juego: 'Juego', parche: 'Parches', expansion: 'Expansiones', mapas: 'Mapas', mod: 'Mods y ladder', herramienta: 'Herramientas' };
const NEWS_CATS = { noticia: 'Noticia', torneo: 'Torneo', juego: 'Juego', importante: 'Importante' };
const newsOut = (r, full) => ({ id: r.id, title: r.title, category: r.category, categoryLabel: NEWS_CATS[r.category] || 'Noticia', eventAt: r.event_at, pinned: !!r.pinned, author: r.author, at: r.created_at, updated: r.updated_at, body: full ? r.body : (r.body.length > 220 ? r.body.slice(0, 220).replace(/\s+\S*$/, '') + '…' : r.body) });
const liveMod = require('./live');
const adminMod = require('./admin');
adminMod.migrate(db);
const getLive = liveMod.create(db);
const serversMod = require('./servers').create(db);

/* Ranking: un clan con menos de MIN_RANK_MEMBERS jugadores queda "sin ranking" (unranked) y va al final de la tabla.
   Con su primera victoria confirmada aparece con su récord, y desde la segunda victoria (RANK_WINS) entra al ranking y empieza a subir. */
const MIN_RANK_MEMBERS = 5, RANK_WINS = 2;
/* Mapas que se pueden elegir al reportar un partido (los mismos de «Lista de mapas»: mapas oficiales MOHAA). */
const MAP_GROUPS = [{"group": "Mapas oficiales MOHAA", "maps": ["The Hunt", "V2", "The Bridge", "St.Lo", "St. Renan", "Rockbound", "V3", "Opcenter", "Asalto Al Monasterio", "Gloomcove", "Howitzer", "X-Fire Village", "Fallen Village", "The Lost Village", "Base Secreta", "Dasboot", "Warehouse", "Resistance", "X-Fire", "Tirtagaine Kechtat", "Bahnhof Steinhude", "Clifftop", "Cambodia Raid", "Staligrado 1942", "Team Zero", "V2 Shelter", "Schplatzburg", "Bob Carentan", "St. Analie", "Arg Hunt", "Palermo", "Blutstein", "Morning", "Enigma", "The Village", "3rd Warehouse", "The Church", "Questufou", "Rush Party", "Ghost", "V2RD-2", "La Patrouille", "Harbor"]}];
const MAP_SET = new Set(MAP_GROUPS.flatMap((g) => g.maps));

function rankFor(c) {
  if (!c || !q.clanElig.get(c.id).e) return null;
  return q.rankOf.get(c.wins, c.wins, c.losses, c.wins, c.losses, c.created_at, c.created_at, c.id).r;
}
const ELIG = (a) => '(((SELECT COUNT(*) FROM clan_members mm WHERE mm.clan_id = ' + a + '.id) >= ' + MIN_RANK_MEMBERS + ' AND ' + a + '.wins + ' + a + '.losses > 0) OR ' + a + '.wins >= ' + RANK_WINS + ')';
const q = {
  insertClan: db.prepare('INSERT INTO clans (name, tag, website, logo, created_at) VALUES (?,?,?,?,?)'),
  insertMember: db.prepare('INSERT INTO clan_members (clan_id, player_id, role, joined_at) VALUES (?,?,?,?)'),
  memberOf: db.prepare('SELECT clan_id, role, joined_at FROM clan_members WHERE player_id = ?'),
  memberCount: db.prepare('SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ?'),
  clanById: db.prepare('SELECT * FROM clans WHERE id = ?'),
  hallWins: db.prepare('SELECT * FROM clans WHERE wins > 0 ORDER BY wins DESC, losses ASC, created_at ASC, id ASC LIMIT 25'),
  hallLosses: db.prepare('SELECT * FROM clans WHERE losses > 0 ORDER BY losses DESC, wins ASC, created_at ASC, id ASC LIMIT 25'),
  allConfirmed: db.prepare("SELECT winner_id, loser_id FROM matches WHERE status = 'confirmed' AND season_id = (SELECT id FROM seasons WHERE status = 'active') ORDER BY resolved_at, id"),
  activeSeason: db.prepare("SELECT * FROM seasons WHERE status = 'active' LIMIT 1"),
  seasonById: db.prepare('SELECT * FROM seasons WHERE id = ?'),
  allSeasons: db.prepare('SELECT * FROM seasons ORDER BY id DESC'),
  insertSeason: db.prepare('INSERT INTO seasons (name, stage, starts_at, ends_at, origin) VALUES (?,?,?,?,?)'),
  setDeadline: db.prepare('UPDATE seasons SET ends_at = ? WHERE id = ?'),
  closeSeasonRow: db.prepare("UPDATE seasons SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ? AND status = 'active'"),
  rankedForClose: db.prepare('SELECT c.id, c.name, c.wins, c.losses, c.streak FROM clans c WHERE c.wins + c.losses > 0 ORDER BY ' + ELIG('c') + ' DESC, c.wins DESC, c.losses ASC, c.created_at ASC, c.id ASC'),
  insertResult: db.prepare('INSERT INTO season_results (season_id, rank, clan_id, clan_name, wins, losses, streak) VALUES (?,?,?,?,?,?,?)'),
  resultsOf: db.prepare('SELECT * FROM season_results WHERE season_id = ? ORDER BY rank'),
  topOf: db.prepare('SELECT * FROM season_results WHERE season_id = ? AND rank <= 3 ORDER BY rank'),
  trophiesOf: db.prepare('SELECT r.rank, s.id AS sid, s.name, s.stage FROM season_results r JOIN seasons s ON s.id = r.season_id WHERE r.clan_id = ? AND r.rank <= 3 ORDER BY s.id DESC'),
  cancelPending: db.prepare("UPDATE matches SET status = 'cancelled', resolved_at = ? WHERE status = 'pending'"),
  resetClans: db.prepare('UPDATE clans SET wins = 0, losses = 0, streak = 0, last_match = 0, trend = 0, cur_rank = 0, last_rank = 0, best_rank = 0, worst_rank = 0'),
  rankIds: db.prepare('SELECT c.id FROM clans c WHERE ' + ELIG('c') + ' ORDER BY c.wins DESC, c.losses ASC, c.created_at ASC, c.id ASC'),
  setTrend: db.prepare('UPDATE clans SET trend = ? WHERE id = ?'),
  rankedCount: db.prepare('SELECT COALESCE(SUM(CASE WHEN ' + ELIG('c') + ' THEN 1 ELSE 0 END), 0) AS ranked, COUNT(*) AS total FROM clans c'),
  lastMatchOf: db.prepare("SELECT m.id, m.status, m.winner_id, m.loser_id, w.name AS wname, l.name AS lname, COALESCE(NULLIF(m.resolved_at, 0), m.created_at) AS at FROM matches m JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id WHERE m.season_id = (SELECT id FROM seasons WHERE status = 'active') AND ((m.status = 'confirmed' AND (m.winner_id = ? OR m.loser_id = ?)) OR (m.status = 'pending' AND m.loser_id = ?)) ORDER BY at DESC, m.id DESC LIMIT 1"),
  clanHist: db.prepare("SELECT winner_id, loser_id FROM matches WHERE status = 'confirmed' AND season_id = (SELECT id FROM seasons WHERE status = 'active') AND (winner_id = ? OR loser_id = ?) ORDER BY resolved_at, id"),
  setRankHist: db.prepare('UPDATE clans SET cur_rank = ?, last_rank = ?, best_rank = ?, worst_rank = ? WHERE id = ?'),
  clanMembers: db.prepare("SELECT p.id, p.alias, m.role, m.joined_at FROM clan_members m JOIN players p ON p.id = m.player_id WHERE m.clan_id = ? ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'coleader' THEN 1 WHEN 'captain' THEN 2 ELSE 3 END, m.joined_at"),
  clanCount: db.prepare('SELECT COUNT(*) AS n FROM clans'),
  clansLike: db.prepare("SELECT c.*, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members, " + ELIG('c') + " AS elig FROM clans c WHERE c.name LIKE ? ESCAPE '\\' ORDER BY elig DESC, c.wins DESC, c.losses ASC, c.created_at ASC, c.id ASC LIMIT ? OFFSET ?"),
  clansLikeName: db.prepare("SELECT c.*, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members, (SELECT m2.player_id FROM clan_members m2 WHERE m2.clan_id = c.id AND m2.role = 'leader' LIMIT 1) AS leader_id FROM clans c WHERE c.name LIKE ? ESCAPE '\\' ORDER BY c.name COLLATE NOCASE, c.id LIMIT ? OFFSET ?"),
  clansLikeCount: db.prepare("SELECT COUNT(*) AS n FROM clans WHERE name LIKE ? ESCAPE '\\'"),
  rankOf: db.prepare('SELECT COUNT(*) + 1 AS r FROM clans c WHERE ' + ELIG('c') + ' AND (c.wins > ? OR (c.wins = ? AND c.losses < ?) OR (c.wins = ? AND c.losses = ? AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))))'),
  clanElig: db.prepare('SELECT ' + ELIG('c') + ' AS e, (SELECT COUNT(*) FROM clan_members mm WHERE mm.clan_id = c.id) AS n FROM clans c WHERE c.id = ?'),
  deleteClan: db.prepare('DELETE FROM clans WHERE id = ?'),
  deleteMember: db.prepare('DELETE FROM clan_members WHERE clan_id = ? AND player_id = ?'),
  setRole: db.prepare('UPDATE clan_members SET role = ? WHERE clan_id = ? AND player_id = ?'),
  playerIdByAlias: db.prepare('SELECT id, alias FROM players WHERE alias = ?'),
  insertInvite: db.prepare('INSERT OR IGNORE INTO clan_invites (clan_id, player_id, created_at) VALUES (?,?,?)'),
  inviteCount: db.prepare('SELECT COUNT(*) AS n FROM clan_invites WHERE clan_id = ?'),
  invitesFor: db.prepare('SELECT c.id, c.name FROM clan_invites i JOIN clans c ON c.id = i.clan_id WHERE i.player_id = ? ORDER BY i.created_at'),
  invitesOf: db.prepare('SELECT p.alias FROM clan_invites i JOIN players p ON p.id = i.player_id WHERE i.clan_id = ? ORDER BY i.created_at'),
  hasInvite: db.prepare('SELECT 1 FROM clan_invites WHERE clan_id = ? AND player_id = ?'),
  deleteInvite: db.prepare('DELETE FROM clan_invites WHERE clan_id = ? AND player_id = ?'),
  clanByName: db.prepare('SELECT id, name FROM clans WHERE name = ?'),
  clanIdName: db.prepare('SELECT id, name FROM clans WHERE id = ?'),
  playerIdOnly: db.prepare('SELECT id, alias FROM players WHERE id = ?'),
  insertMatch: db.prepare("INSERT INTO matches (winner_id, loser_id, reporter_id, status, created_at, report_comment, season_id) VALUES (?,?,?,'pending',?,?,?)"),
  insertMatchPlayer: db.prepare('INSERT OR IGNORE INTO match_players (match_id, player_id, side) VALUES (?,?,?)'),
  matchPlayers: db.prepare('SELECT p.id, p.alias FROM match_players mp JOIN players p ON p.id = mp.player_id WHERE mp.match_id = ? AND mp.side = ? ORDER BY p.alias COLLATE NOCASE'),
  confirmMatch: db.prepare("UPDATE matches SET status = 'confirmed', resolved_at = ?, confirm_comment = ?, confirmer_id = ? WHERE id = ? AND status = 'pending'"),
  playerRecord: db.prepare("SELECT mp.side AS side, COUNT(*) AS n FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = ? AND m.season_id = (SELECT id FROM seasons WHERE status = 'active') AND ((mp.side = 'loser' AND m.status IN ('pending','confirmed')) OR (mp.side = 'winner' AND m.status = 'confirmed')) GROUP BY mp.side"),
  matchFull: db.prepare('SELECT m.*, w.name AS wname, l.name AS lname, rp.alias AS reporter, cp.alias AS confirmer, s.name AS sname, s.stage AS sstage FROM matches m LEFT JOIN seasons s ON s.id = m.season_id JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id LEFT JOIN players rp ON rp.id = m.reporter_id LEFT JOIN players cp ON cp.id = m.confirmer_id WHERE m.id = ?'),
  matchById: db.prepare('SELECT * FROM matches WHERE id = ?'),
  pendingPair: db.prepare("SELECT 1 FROM matches WHERE status = 'pending' AND ((winner_id = ? AND loser_id = ?) OR (winner_id = ? AND loser_id = ?))"),
  pendingByLoser: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'pending' AND loser_id = ?"),
  setMatch: db.prepare("UPDATE matches SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'"),
  toConfirm: db.prepare("SELECT m.id, m.created_at, m.report_comment, m.map1, m.map2, c.id AS cid, c.name FROM matches m JOIN clans c ON c.id = m.loser_id WHERE m.status = 'pending' AND m.winner_id = ? ORDER BY m.created_at"),
  toConfirmCount: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'pending' AND winner_id = ?"),
  reportedBy: db.prepare("SELECT m.id, m.created_at, c.id AS cid, c.name FROM matches m JOIN clans c ON c.id = m.winner_id WHERE m.status = 'pending' AND m.loser_id = ? ORDER BY m.created_at"),
  recentMatches: db.prepare("SELECT m.id, m.resolved_at, w.id AS wid, w.name AS wname, l.id AS lid, l.name AS lname, s.name AS sname, s.stage AS sstage FROM matches m JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id LEFT JOIN seasons s ON s.id = m.season_id WHERE m.status = 'confirmed' ORDER BY m.resolved_at DESC, m.id DESC LIMIT ? OFFSET ?"),
  recentMatchesOf: db.prepare("SELECT m.id, m.resolved_at, w.id AS wid, w.name AS wname, l.id AS lid, l.name AS lname, s.name AS sname, s.stage AS sstage FROM matches m JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id LEFT JOIN seasons s ON s.id = m.season_id WHERE m.status = 'confirmed' AND (m.winner_id = ? OR m.loser_id = ?) ORDER BY m.resolved_at DESC, m.id DESC LIMIT 20"),
  matchCount: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'confirmed'"),
  matchesSince: db.prepare("SELECT COUNT(*) AS n FROM matches WHERE status = 'confirmed' AND resolved_at >= ?"),
  markLoss: db.prepare('UPDATE matches SET loss_applied = 1, prev_streak = ?, prev_last = ?, set_streak = ? WHERE id = ?'),
  undoLoss: db.prepare('UPDATE clans SET losses = MAX(0, losses - 1), streak = CASE WHEN streak = ? THEN ? ELSE streak END, last_match = CASE WHEN last_match = ? THEN ? ELSE last_match END WHERE id = ?'),
  addWin: db.prepare('UPDATE clans SET wins = wins + 1, streak = CASE WHEN streak > 0 THEN streak + 1 ELSE 1 END, last_match = ? WHERE id = ?'),
  addLoss: db.prepare('UPDATE clans SET losses = losses + 1, streak = CASE WHEN streak < 0 THEN streak - 1 ELSE -1 END, last_match = ? WHERE id = ?'),
  deleteInvitesOfPlayer: db.prepare('DELETE FROM clan_invites WHERE player_id = ?'),
  insertPlayer: db.prepare(
    'INSERT INTO players (alias, email, pass_hash, icq, aim, msn, website, logo, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ),
  playerByAlias: db.prepare('SELECT id, alias, pass_hash, verified, active FROM players WHERE alias = ?'),
  updateClan: db.prepare('UPDATE clans SET name = ?, tag = ?, website = ?, logo = ? WHERE id = ?'),
  playerFull: db.prepare('SELECT id, alias, created_at, icq, aim, msn, website, logo, steam, discord, twitch, youtube FROM players WHERE id = ?'),
  playerById: db.prepare('SELECT id, alias, created_at, verified, active FROM players WHERE id = ?'),
  setCode: db.prepare('UPDATE players SET verified = 0, code_hash = ?, code_exp = ?, code_tries = 0 WHERE id = ?'),
  playerForCode: db.prepare('SELECT id, email, verified, code_hash, code_exp, code_tries FROM players WHERE alias = ?'),
  addTry: db.prepare('UPDATE players SET code_tries = code_tries + 1 WHERE id = ?'),
  setVerified: db.prepare("UPDATE players SET verified = 1, code_hash = '', code_exp = 0, code_tries = 0 WHERE id = ?"),
  aliasExists: db.prepare('SELECT 1 FROM players WHERE alias = ?'),
  emailExists: db.prepare('SELECT 1 FROM players WHERE email = ?'),
  countPlayers: db.prepare('SELECT COUNT(*) AS n FROM players'),
  listPlayers: db.prepare("SELECT id, alias, created_at, verified, icq, aim, msn, website FROM players WHERE alias LIKE ? ESCAPE '\\' ORDER BY alias COLLATE NOCASE LIMIT ? OFFSET ?"),
  countLike: db.prepare("SELECT COUNT(*) AS n FROM players WHERE alias LIKE ? ESCAPE '\\'"),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES (?,?,?,?)'),
  sessionByHash: db.prepare('SELECT player_id, expires_at FROM sessions WHERE token_hash = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
};

setInterval(() => { try { q.deleteExpired.run(Date.now()); } catch (_) { /* ignorar */ } }, 60 * 60 * 1000).unref();

/* ---------- Contraseñas (scrypt, incluido en Node) ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scrypt(password, salt, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const opts = { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), keylen: 64 };
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const key = await scrypt(password.normalize('NFKC'), salt, { ...opts, keylen: expected.length });
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// Hash falso para que un alias inexistente tarde lo mismo que uno existente.
let DUMMY_HASH = null;
hashPassword('relleno-para-igualar-tiempos').then((h) => { DUMMY_HASH = h; });

/* ---------- Utilidades HTTP ---------- */
function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'desconocida';
}

function isHttps(req) {
  if (req.socket.encrypted) return true;
  return TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-src https://player.twitch.tv https://www.youtube-nocookie.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function sendJson(res, status, body, extraHeaders) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  });
  res.end(data);
}

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') { reject({ status: 415, message: 'Formato no permitido.' }); return; }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > (maxBytes || 10 * 1024)) { reject({ status: 413, message: 'Solicitud demasiado grande.' }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('forma');
        resolve(v);
      } catch (_) { reject({ status: 400, message: 'Datos inválidos.' }); }
    });
    req.on('error', () => reject({ status: 400, message: 'Datos inválidos.' }));
  });
}

// Defensa contra solicitudes desde otros sitios: si el navegador envía Origin, debe ser este mismo sitio.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

/* ---------- Límite de intentos (en memoria) ---------- */
const hits = new Map();
function isLimited(req, bucket, max) {
  const rec = hits.get(bucket + '|' + clientIp(req));
  return !!rec && rec.reset >= Date.now() && rec.n >= max;
}
function addHit(req, bucket, windowMs) {
  const key = bucket + '|' + clientIp(req);
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || rec.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
  else rec.n += 1;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 10 * 60 * 1000).unref();

/* ---------- Sesiones ---------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sessionCookie(req, token, maxAgeMs) {
  const parts = ['sid=' + token, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs) parts.push('Max-Age=' + Math.floor(maxAgeMs / 1000));
  if (FORCE_SECURE || isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(req) {
  const parts = ['sid=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (FORCE_SECURE || isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function createSession(req, playerId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = remember ? SESSION_REMEMBER_MS : SESSION_SHORT_MS;
  const now = Date.now();
  q.insertSession.run(sha256(token), playerId, now, now + ttl);
  return sessionCookie(req, token, remember ? ttl : 0);
}

function currentPlayer(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = q.sessionByHash.get(sha256(token));
  if (!s || s.expires_at < Date.now()) return null;
  const pl = q.playerById.get(s.player_id) || null;
  return pl && pl.active !== 0 ? pl : null;
}

/* ---------- Validación ---------- */
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/* Redes sociales del jugador: acepta el enlace completo o solo el nombre de usuario. '' = vacío, null = no válido. */
const SOCIAL = {
  steam:   { hosts: ['steamcommunity.com', 'www.steamcommunity.com'], make: (h) => 'https://steamcommunity.com/id/' + h, handle: /^[A-Za-z0-9_-]{2,40}$/ },
  twitch:  { hosts: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'], make: (h) => 'https://www.twitch.tv/' + h, handle: /^[A-Za-z0-9_]{2,40}$/ },
  youtube: { hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'], make: (h) => 'https://www.youtube.com/@' + h.replace(/^@/, ''), handle: /^@?[A-Za-z0-9_.-]{2,40}$/ },
  discord: { hosts: ['discord.gg', 'discord.com', 'www.discord.com'], make: null, handle: /^[A-Za-z0-9_.#]{2,40}$/ },
};
function socialValue(kind, v) {
  const s = clean(v, 200);
  if (!s) return '';
  const cfg = SOCIAL[kind];
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' && cfg.hosts.includes(u.hostname.toLowerCase()) ? u.href : null;
    } catch (_) { return null; }
  }
  if (!cfg.handle.test(s)) return null;
  return cfg.make ? cfg.make(s) : s;
}

function httpUrl(v) {
  const s = clean(v, 300);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch (_) { return null; }
}

function validateRegistration(b) {
  const alias = clean(b.alias, 40);
  const email = clean(b.email, 254).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const website = '';
  const logo = httpUrl(b.logo);

  if (alias.length < 3 || alias.length > 24) return { error: 'El nombre debe tener entre 3 y 24 caracteres.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Escribe un email válido.' };
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  if (password.length > 128) return { error: 'La contraseña es demasiado larga.' };
  if (password.toLowerCase() === alias.toLowerCase()) return { error: 'La contraseña no puede ser igual al nombre.' };
  if (b.age13 !== true) return { error: 'Debes confirmar que tienes al menos 13 años.' };
  if (website === null) return { error: 'El sitio web debe empezar con http:// o https://.' };
  if (logo === null) return { error: 'El logo debe ser un enlace que empiece con http:// o https://.' };
  const social = {};
  const sNames = { steam: 'Steam', discord: 'Discord', twitch: 'Twitch', youtube: 'YouTube' };
  for (const k of Object.keys(SOCIAL)) {
    const sv = socialValue(k, b[k]);
    if (sv === null) return { error: 'El dato de ' + sNames[k] + ' no es válido. Escribe tu usuario o el enlace de tu perfil de ' + sNames[k] + '.' };
    social[k] = sv;
  }

  return {
    value: {
      alias, email, password, website, logo, social,
      icq: '', aim: '', msn: '',
    },
  };
}

/* ---------- Quién está en el sitio (en memoria) ---------- */
const ONLINE_MS = 3 * 60 * 1000;
const seenGuests = new Map();   // id de visita anónima -> última señal
const seenPlayers = new Map();  // id de jugador -> última señal
function onlineCounts() {
  const cut = Date.now() - ONLINE_MS;
  let guests = 0, players = 0;
  for (const [k, t] of seenGuests) { if (t < cut) seenGuests.delete(k); else guests++; }
  for (const [k, t] of seenPlayers) { if (t < cut) seenPlayers.delete(k); else players++; }
  return { guests, players };
}

/* ---------- Validación de cuenta por email ---------- */
// SMTP con TLS directo (puerto 465). Variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.
// Sin SMTP el código se escribe en la consola del servidor y no se exige validar para entrar.
const SMTP = process.env.SMTP_HOST ? {
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 465,
  user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
} : null;
// Administradores de la comunidad: alias separados por coma en la variable ADMIN_ALIAS
const ADMINS = new Set((process.env.ADMIN_ALIAS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
const ADMIN_SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN || '';
function authorizedAdminRegistration(alias, token) {
  if (!ADMINS.has(String(alias).toLowerCase())) return true;
  if (ADMIN_SETUP_TOKEN.length < 32 || typeof token !== 'string') return false;
  const supplied = Buffer.from(token);
  const expected = Buffer.from(ADMIN_SETUP_TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
let panel = null; // panel de administración (admin.js), se inicia antes de las rutas
const isAdmin = (p) => !!p && !!panel && panel.can(p, 'seasons.manage');
const seasonLabel = (name, stage) => (name ? name + (stage ? ' • ' + stage : '') : '');
const REQUIRE_VERIFY = process.env.REQUIRE_VERIFY ? process.env.REQUIRE_VERIFY === '1' : !!SMTP;
const CODE_TTL_MS = 48 * 60 * 60 * 1000;
const MAX_CODE_TRIES = 5;

function sendMail(to, subject, text) {
  return new Promise((resolve, reject) => {
    const tls = require('node:tls');
    const sock = tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host });
    sock.setTimeout(15000, () => { sock.destroy(); reject(new Error('SMTP timeout')); });
    sock.on('error', reject);
    let buf = '';
    let waiting = null;
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n');
      if (lines.length > 1 && /^\d{3} /.test(lines[lines.length - 2] || '')) {
        const last = lines[lines.length - 2]; buf = '';
        if (waiting) { const w = waiting; waiting = null; w(last); }
      }
    });
    const reply = () => new Promise((r) => { waiting = r; });
    const cmd = async (c, ok) => {
      if (c !== null) sock.write(c + '\r\n');
      const r = await reply();
      if (!r.startsWith(ok)) throw new Error('SMTP: ' + r);
    };
    const hdr = (v) => String(v).replace(/[\r\n]/g, ' ');
    (async () => {
      await cmd(null, '220');
      await cmd('EHLO ladder', '250');
      await cmd('AUTH LOGIN', '334');
      await cmd(Buffer.from(SMTP.user).toString('base64'), '334');
      await cmd(Buffer.from(SMTP.pass).toString('base64'), '235');
      await cmd('MAIL FROM:<' + hdr(SMTP.from).replace(/[<>]/g, '') + '>', '250');
      await cmd('RCPT TO:<' + hdr(to).replace(/[<>]/g, '') + '>', '250');
      await cmd('DATA', '354');
      const body = text.replace(/^\./gm, '..').replace(/\r?\n/g, '\r\n');
      await cmd('From: ' + hdr(SMTP.from) + '\r\nTo: ' + hdr(to) + '\r\nSubject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n' + body + '\r\n.', '250');
      sock.write('QUIT\r\n'); sock.end(); resolve();
    })().catch((e) => { sock.destroy(); reject(e); });
  });
}

async function issueCode(playerId, alias, email) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  q.setCode.run(sha256(code + ':' + playerId), Date.now() + CODE_TTL_MS, playerId);
  const text = 'Hola ' + alias + ',\n\nTu código para validar la cuenta es: ' + code + '\n\nIngrésalo en la sección «Validar cuenta» del sitio. Vence en 48 horas.\nSi no creaste esta cuenta, ignora este mensaje.';
  if (!SMTP) { console.log('[validación] SMTP no configurado. Código de ' + alias + ': ' + code); return false; }
  try { await sendMail(email, 'Código de validación de cuenta', text); return true; }
  catch (e) { console.error('[validación] no se pudo enviar el correo:', e.message); return false; }
}

/* ---------- Panel de administración ---------- */
panel = adminMod.init({ db, ADMINS, currentPlayer, sendJson, readJson, clean, isLimited, addHit, clientIp, q, DATA_DIR, CAN_MATCH });
const playerRec = (pid) => panel.playerRecord(pid, q.playerRecord.all(pid));

/* ---------- Rutas de la API ---------- */
async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/me') {
    const p = currentPlayer(req);
    if (!p) return sendJson(res, 200, { player: null });
    const mm = q.memberOf.get(p.id);
    const leader = !!(mm && CAN_MATCH.includes(mm.role));
    return sendJson(res, 200, { player: { id: p.id, alias: p.alias, verified: !!p.verified, admin: isAdmin(p), staff: !!(panel.roleOf(p) && panel.roleOf(p) !== 'news'), leader, toConfirm: leader ? q.toConfirmCount.get(mm.clan_id).n : 0 } });
  }

  const onlineList = () => {
    onlineCounts();
    const rows = [];
    for (const id of seenPlayers.keys()) {
      const pr = db.prepare('SELECT id, alias, active FROM players WHERE id = ?').get(id);
      if (!pr || !pr.active) continue;
      const mm = q.memberOf.get(id), cl = mm ? q.clanIdName.get(mm.clan_id) : null;
      rows.push({ id: pr.id, alias: pr.alias, staff: !!(panel.roleOf(pr) && panel.roleOf(pr) !== 'news'), clanId: cl ? cl.id : 0, clan: cl ? cl.name : '', role: mm ? mm.role : '', at: seenPlayers.get(id) });
    }
    return rows.sort((x, y) => x.alias.localeCompare(y.alias));
  };
  if (req.method === 'GET' && pathname === '/api/denuncias-recientes') {
    // Resumen público: no incluye quién denunció ni el detalle. Solo el denunciado, el estado y la sanción del caso.
    const TL = { warning: 'Advertencia', reprimand: 'Amonestación oficial', point_loss: 'Pérdida de puntos', result_annulment: 'Anulación de resultado', ladder_suspension: 'Suspensión de la Ladder', tournament_suspension: 'Suspensión de torneos', temp_disqualification: 'Inhabilitación temporal', expulsion: 'Expulsión', permanent_ban: 'Baneo permanente' };
    const SS = { active: 'vigente', expired: 'cumplida', revoked: 'revocada', annulled: 'revocada' };
    const rows = db.prepare('SELECT c.id, c.status, c.created_at, c.sanction_id, p.id AS pid, p.alias FROM complaints c JOIN players p ON p.id = c.accused_id ORDER BY c.id DESC LIMIT 8').all();
    const out = rows.map((c) => {
      const sa = db.prepare('SELECT type, status FROM sanctions WHERE id = ? OR complaint_id = ? ORDER BY id DESC LIMIT 1').get(c.sanction_id || 0, c.id);
      return { id: c.id, at: c.created_at, accusedId: c.pid, accused: c.alias, status: c.status, sanction: sa ? { type: TL[sa.type] || sa.type, status: SS[sa.status] || sa.status } : null };
    });
    return sendJson(res, 200, { complaints: out });
  }

  if (req.method === 'GET' && pathname === '/api/online') {
    if (!currentPlayer(req)) return sendJson(res, 401, { error: 'No estás logeado.' });
    return sendJson(res, 200, { players: onlineList().map((r) => ({ id: r.id, alias: r.alias, clanId: r.clanId, clan: r.clan, role: r.role, staff: r.staff, at: r.at })) });
  }
  if (req.method === 'GET' && pathname === '/api/stats') {
    const o = onlineCounts();
    const sea0 = q.activeSeason.get();
    return sendJson(res, 200, { season: sea0 ? { id: sea0.id, name: sea0.name, stage: sea0.stage, label: seasonLabel(sea0.name, sea0.stage), endsAt: sea0.ends_at } : null, players: q.countPlayers.get().n, clans: q.clanCount.get().n, online: o.players, staff: onlineList().filter((r) => r.staff).length, guests: o.guests, matchesToday: q.matchesSince.get(Date.now() - 24 * 60 * 60 * 1000).n });
  }

  /* ----- Temporadas (ladders) ----- */
  const seasonPublic = (r) => ({ id: r.id, name: r.name, stage: r.stage, label: seasonLabel(r.name, r.stage), status: r.status, startsAt: r.starts_at, endsAt: r.ends_at, closedAt: r.closed_at });
  if (req.method === 'GET' && pathname === '/api/seasons') {
    return sendJson(res, 200, { seasons: q.allSeasons.all().map((r) => Object.assign(seasonPublic(r), {
      top: r.status === 'closed' ? q.topOf.all(r.id).map((t) => ({ rank: t.rank, clanId: t.clan_id, clan: t.clan_name })) : [],
    })) });
  }
  if (req.method === 'GET' && pathname === '/api/season') {
    const r = q.seasonById.get(parseInt(new URL(req.url, 'http://x').searchParams.get('id'), 10) || 0);
    if (!r) return sendJson(res, 404, { error: 'Esa temporada no existe.' });
    return sendJson(res, 200, { season: seasonPublic(r), results: q.resultsOf.all(r.id).map((x) => ({ rank: x.rank, clanId: x.clan_id, clan: x.clan_name, wins: x.wins, losses: x.losses, streak: x.streak })) });
  }
  const needAdmin = () => {
    const p = currentPlayer(req);
    if (!isAdmin(p)) { sendJson(res, 403, { error: 'Solo el administrador de la comunidad puede hacer esto.' }); return null; }
    return p;
  };
  if (req.method === 'POST' && pathname === '/api/admin/season/create') {
    const p = needAdmin(); if (!p) return;
    const b = await readJson(req);
    const name = clean(b.name, 40), stage = clean(b.stage, 30), endsAt = Math.floor(Number(b.endsAt) || 0);
    if (name.length < 3) return sendJson(res, 400, { error: 'El nombre de la temporada debe tener al menos 3 caracteres.' });
    if (endsAt && endsAt <= Date.now()) return sendJson(res, 400, { error: 'La fecha de cierre debe ser futura.' });
    if (q.activeSeason.get()) return sendJson(res, 409, { error: 'Ya hay una temporada activa. Ciérrala antes de crear otra.' });
    const id = Number(q.insertSeason.run(name, stage, Date.now(), endsAt, '').lastInsertRowid);
    return sendJson(res, 201, { season: { id } });
  }
  if (req.method === 'POST' && pathname === '/api/admin/season/deadline') {
    const p = needAdmin(); if (!p) return;
    const b = await readJson(req);
    const sea = q.activeSeason.get();
    if (!sea) return sendJson(res, 409, { error: 'No hay una temporada activa.' });
    const endsAt = Math.floor(Number(b.endsAt) || 0);
    if (endsAt && endsAt <= Date.now()) return sendJson(res, 400, { error: 'La fecha de cierre debe ser futura.' });
    q.setDeadline.run(endsAt, sea.id);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && pathname === '/api/admin/season/close') {
    const p = needAdmin(); if (!p) return;
    const id = closeSeason(p.alias);
    if (!id) return sendJson(res, 409, { error: 'No hay una temporada activa.' });
    return sendJson(res, 200, { ok: true, seasonId: id });
  }

  if (req.method === 'GET' && pathname === '/api/player') {
    // Perfil público de un jugador. El email y los comentarios de administrador solo los ve el equipo.
    const u = new URL(req.url, 'http://x');
    const pid = parseInt(u.searchParams.get('id'), 10) || 0;
    const pr = pid > 0 ? db.prepare('SELECT id, alias, email, created_at, verified, icq, aim, msn, website, active, steam, discord, twitch, youtube FROM players WHERE id = ?').get(pid) : null;
    if (!pr || !pr.active) return sendJson(res, 404, { error: 'Ese jugador no existe.' });
    const viewer = currentPlayer(req);
    const staffView = !!viewer && panel.can(viewer, 'players.view');
    const mm = q.memberOf.get(pr.id);
    const cl = mm ? db.prepare('SELECT id, name, logo FROM clans WHERE id = ?').get(mm.clan_id) : null;
    const rec = playerRec(pr.id);
    const act = q.activeSeason.get();
    const teams = [];
    if (cl) teams.push({ clanId: cl.id, clan: cl.name, ladder: act ? seasonLabel(act.name, act.stage) : '', status: mm.role, joined: mm.joined_at, current: true, seasonId: act ? act.id : 0 });
    const past = db.prepare("SELECT DISTINCT CASE WHEN mp.side = 'winner' THEN m.winner_id ELSE m.loser_id END AS clan_id, m.season_id AS season_id FROM match_players mp JOIN matches m ON m.id = mp.match_id WHERE mp.player_id = ? AND m.status NOT IN ('deleted', 'cancelled') ORDER BY m.season_id DESC").all(pr.id);
    for (const r of past) {
      if (cl && r.clan_id === cl.id && act && r.season_id === act.id) continue;
      const c2 = db.prepare('SELECT id, name FROM clans WHERE id = ?').get(r.clan_id);
      const se = q.seasonById.get(r.season_id);
      if (!c2) continue;
      teams.push({ clanId: c2.id, clan: c2.name, ladder: se ? seasonLabel(se.name, se.stage) : '', status: 'inactive', joined: 0, current: false, seasonId: r.season_id });
    }
    // Comentarios de administrador: los ve cualquiera (usuario o invitado), pero solo los que el equipo marcó como públicos.
    const comments = db.prepare("SELECT body, by_alias, created_at FROM admin_notes WHERE target_type = 'player' AND target_id = ? AND public = 1 ORDER BY id DESC LIMIT 50").all(pr.id).map((n) => ({ text: n.body, by: n.by_alias, at: n.created_at }));
    // Sanciones aplicadas al jugador (públicas): tipo, motivo, denuncia de origen y duración. Sin descripciones internas ni evidencias.
    const TLS = { warning: 'Advertencia', reprimand: 'Amonestación oficial', point_loss: 'Pérdida de puntos', result_annulment: 'Anulación de resultado', ladder_suspension: 'Suspensión de la Ladder', tournament_suspension: 'Suspensión de torneos', temp_disqualification: 'Inhabilitación temporal', expulsion: 'Expulsión', permanent_ban: 'Baneo permanente' };
    const sanctions = db.prepare("SELECT s.id, s.type, s.reason_code, s.complaint_id, s.starts_at, s.ends_at, s.status, s.pts, (SELECT label FROM sanction_reasons r WHERE r.code = s.reason_code) AS reason FROM sanctions s WHERE s.target_type = 'player' AND s.player_id = ? ORDER BY s.id DESC LIMIT 50").all(pr.id).map((x) => ({
      id: x.id, type: x.type, typeLabel: TLS[x.type] || x.type, reason: x.reason || '', complaintId: x.complaint_id || 0,
      at: x.starts_at, endsAt: x.ends_at, pts: x.pts, status: x.status === 'active' && x.ends_at > 0 && x.ends_at <= Date.now() ? 'expired' : x.status,
    }));
    return sendJson(res, 200, {
      player: { id: pr.id, alias: pr.alias, joined: pr.created_at, verified: !!pr.verified, social: { steam: pr.steam, discord: pr.discord, twitch: pr.twitch, youtube: pr.youtube }, email: staffView ? pr.email : undefined },
      clan: cl ? { id: cl.id, name: cl.name, role: mm.role, joined: mm.joined_at, logo: cl.logo } : null,
      teams, comments, sanctions, staff: staffView,
      wins: Number((rec.find((x) => x.side === 'winner') || {}).n || 0), losses: Number((rec.find((x) => x.side === 'loser') || {}).n || 0),
    });
  }

  if (req.method === 'GET' && pathname === '/api/players') {
    // Lista pública: nombre, ID, fecha y los datos opcionales que el jugador eligió completar (ICQ, AIM, MSN, web). Nunca el email.
    const u = new URL(req.url, 'http://x');
    const term = clean(u.searchParams.get('q') || '', 40).replace(/[\\%_]/g, (c) => '\\' + c);
    const page = Math.max(1, Math.min(100000, parseInt(u.searchParams.get('page'), 10) || 1));
    const per = 25;
    const like = '%' + term + '%';
    const total = q.countLike.get(like).n;
    const rows = q.listPlayers.all(like, per, (page - 1) * per).map((r) => ({ id: r.id, alias: r.alias, joined: r.created_at, verified: !!r.verified, clan: ((m) => { const c = m ? db.prepare('SELECT name FROM clans WHERE id = ?').get(m.clan_id) : null; return c ? c.name : ''; })(q.memberOf.get(r.id)) }));
    return sendJson(res, 200, { total, page, per, players: rows });
  }

  if (req.method === 'POST' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Solicitud no permitida.' });

  if (/^\/api\/(admin\/(?!season\/)|evidence\/|my\/admin$|appeal$|disc\/respond$|complaint\/create$)/.test(pathname)) return void (await panel.handle(req, res, pathname));

  if (req.method === 'POST' && (pathname === '/api/register' || pathname === '/api/login' || pathname === '/api/logout' || pathname === '/api/verify' || pathname === '/api/resend')) {
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Solicitud no permitida.' });
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    if (isLimited(req, 'register', 20)) return sendJson(res, 429, { error: 'Demasiados intentos. Prueba más tarde.' });
    addHit(req, 'register', 60 * 60 * 1000);
    const body = await readJson(req);
    const v = validateRegistration(body);
    if (v.error) return sendJson(res, 400, { error: v.error });
    const d = v.value;

    if (!authorizedAdminRegistration(d.alias, body.adminSetupToken)) {
      return sendJson(res, 403, { error: 'Este alias está reservado. Solicita al responsable el código de alta administrativa.' });
    }

    if (q.aliasExists.get(d.alias)) return sendJson(res, 409, { error: 'Ese nombre ya está en uso.' });
    if (q.emailExists.get(d.email)) return sendJson(res, 409, { error: 'Ese email ya está registrado.' });

    const hash = await hashPassword(d.password);
    let id;
    try {
      const r = q.insertPlayer.run(d.alias, d.email, hash, d.icq, d.aim, d.msn, d.website, d.logo, Date.now());
      id = Number(r.lastInsertRowid);
      db.prepare('UPDATE players SET steam = ?, discord = ?, twitch = ?, youtube = ? WHERE id = ?').run(d.social.steam, d.social.discord, d.social.twitch, d.social.youtube, id);
    } catch (e) {
      // Dos registros simultáneos con el mismo nombre o email.
      return sendJson(res, 409, { error: 'Ese nombre o email ya está en uso.' });
    }
    const sent = await issueCode(id, d.alias, d.email);
    const cookie = createSession(req, id, false);
    return sendJson(res, 201, { player: { id, alias: d.alias, verified: false }, mailSent: sent, requireVerify: REQUIRE_VERIFY }, { 'Set-Cookie': cookie });
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    if (isLimited(req, 'login', 10)) return sendJson(res, 429, { error: 'Demasiados intentos fallidos. Prueba en unos minutos.' });
    const body = await readJson(req);
    const alias = clean(body.alias, 40);
    const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
    const row = alias ? q.playerByAlias.get(alias) : null;
    const ok = await verifyPassword(password, row ? row.pass_hash : (DUMMY_HASH || ''));
    if (!row || !ok) { addHit(req, 'login', 15 * 60 * 1000); return sendJson(res, 401, { error: 'Nombre o contraseña incorrectos.' }); }
    if (row.active === 0) return sendJson(res, 403, { error: 'Esta cuenta está desactivada. Contacta a la administración.' });
    if (REQUIRE_VERIFY && !row.verified) return sendJson(res, 403, { error: 'Tu cuenta aún no está validada. Revisa tu email y usa «Validar cuenta».', needVerify: true });
    const cookie = createSession(req, row.id, body.remember === true);
    return sendJson(res, 200, { player: { id: row.id, alias: row.alias, verified: !!row.verified } }, { 'Set-Cookie': cookie });
  }

  if (req.method === 'POST' && pathname === '/api/verify') {
    if (isLimited(req, 'verify', 15)) return sendJson(res, 429, { error: 'Demasiados intentos. Prueba más tarde.' });
    const body = await readJson(req);
    const alias = clean(body.alias, 40);
    const code = clean(body.code, 12);
    const row = alias ? q.playerForCode.get(alias) : null;
    const bad = () => { addHit(req, 'verify', 15 * 60 * 1000); return sendJson(res, 400, { error: 'Nombre o código incorrecto.' }); };
    if (!row || !/^\d{6}$/.test(code)) return bad();
    if (row.verified) return sendJson(res, 200, { ok: true, already: true });
    if (row.code_exp < Date.now() || row.code_tries >= MAX_CODE_TRIES) return sendJson(res, 400, { error: 'El código venció o tuvo demasiados intentos. Pide uno nuevo.' });
    const a = Buffer.from(sha256(code + ':' + row.id)); const b = Buffer.from(row.code_hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { q.addTry.run(row.id); return bad(); }
    q.setVerified.run(row.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/resend') {
    // Respuesta idéntica exista o no la cuenta, para no revelar qué nombres están registrados.
    if (isLimited(req, 'resend', 5)) return sendJson(res, 429, { error: 'Demasiados intentos. Prueba más tarde.' });
    addHit(req, 'resend', 60 * 60 * 1000);
    const body = await readJson(req);
    const alias = clean(body.alias, 40);
    const row = alias ? q.playerForCode.get(alias) : null;
    if (row && !row.verified) await issueCode(row.id, alias, row.email);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = parseCookies(req).sid;
    if (token) q.deleteSession.run(sha256(token));
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie(req) });
  }


  if (req.method === 'POST' && pathname === '/api/ping') {
    // Señal de presencia: cada pestaña abierta avisa cada minuto. Un jugador con sesión cuenta como conectado; los demás, como invitados.
    if (isLimited(req, 'ping', 600)) return sendJson(res, 429, { error: 'Demasiadas señales.' });
    addHit(req, 'ping', 60 * 60 * 1000);
    const b = await readJson(req);
    const vid = typeof b.vid === 'string' && /^[a-f0-9]{16,32}$/.test(b.vid) ? b.vid : null;
    const p = currentPlayer(req);
    if (p) { seenPlayers.set(p.id, Date.now()); if (vid) seenGuests.delete(vid); }
    else if (vid && (seenGuests.has(vid) || seenGuests.size < 5000)) seenGuests.set(vid, Date.now());
    const o = onlineCounts();
    return sendJson(res, 200, { online: o.players, guests: o.guests });
  }

  /* ----- Clanes ----- */
  const urlq = new URL(req.url, 'http://x');
  const escLike = (t) => t.replace(/[\\%_]/g, (c) => '\\' + c);
  const clanPublic = (c, extra) => Object.assign({
    id: c.id, name: c.name, tag: c.tag, website: c.website, logo: c.logo,
    wins: c.wins, losses: c.losses, streak: c.streak, lastMatch: c.last_match, created: c.created_at,
  }, extra || {});
  const needPlayer = () => {
    const p = currentPlayer(req);
    if (!p) { sendJson(res, 401, { error: 'Inicia sesión para hacer esto.' }); return null; }
    if (REQUIRE_VERIFY && !p.verified) { sendJson(res, 403, { error: 'Primero valida tu cuenta.' }); return null; }
    return p;
  };
  const needRole = (p, roles, msg) => {
    const m = q.memberOf.get(p.id);
    if (!m || !roles.includes(m.role)) { sendJson(res, 403, { error: msg }); return null; }
    return m.clan_id;
  };
  const myLeaderClan = (p) => needRole(p, CAN_EDIT, 'Solo un Líder del clan puede hacer esto.');
  const myRecruitClan = (p) => needRole(p, CAN_RECRUIT, 'Solo un Líder o Colíder puede reclutar jugadores.');
  const myMatchClan = (p) => needRole(p, CAN_MATCH, 'Solo Líder, Colíder o Capitán pueden reportar y confirmar partidos.');

  if (req.method === 'GET' && pathname === '/api/clans') {
    const term = clean(urlq.searchParams.get('q') || '', 40);
    const page = Math.max(1, Math.min(100000, parseInt(urlq.searchParams.get('page'), 10) || 1));
    const per = 25, like = '%' + escLike(term) + '%';
    const byName = urlq.searchParams.get('sort') === 'name';
    const rows = (byName ? q.clansLikeName : q.clansLike).all(like, per, (page - 1) * per);
    return sendJson(res, 200, {
      total: q.clansLikeCount.get(like).n, page, per,
      ranked: q.rankedCount.get().ranked, totalClans: q.rankedCount.get().total,
      clans: rows.map((c, i) => {
        const extra = { members: c.members, leaderId: c.leader_id || 0, rank: term || byName ? null : (c.elig ? (page - 1) * per + i + 1 : null), unranked: !c.elig, trend: c.trend };
        if (!byName) {
          const lm = q.lastMatchOf.get(c.id, c.id, c.id);
          if (lm) { const won = lm.winner_id === c.id; extra.last = { matchId: lm.id, confirmed: lm.status === 'confirmed', won, opponentId: won ? lm.loser_id : lm.winner_id, opponent: won ? lm.lname : lm.wname }; }
        }
        return clanPublic(c, extra);
      }),
    });
  }

  if (req.method === 'GET' && pathname === '/api/hall') {
    const type = urlq.searchParams.get('type');
    let list;
    if (type === 'wins') list = q.hallWins.all();
    else if (type === 'losses') list = q.hallLosses.all();
    else if (type === 'streak') {
      const best = new Map(), run = new Map();
      for (const m of q.allConfirmed.all()) {
        const w = (run.get(m.winner_id) || 0) > 0 ? run.get(m.winner_id) + 1 : 1;
        run.set(m.winner_id, w); if (w > (best.get(m.winner_id) || 0)) best.set(m.winner_id, w);
        const l = (run.get(m.loser_id) || 0) < 0 ? run.get(m.loser_id) - 1 : -1;
        run.set(m.loser_id, l);
      }
      list = [...best.entries()].map(([id, b]) => ({ c: q.clanById.get(id), b })).filter((x) => x.c)
        .sort((x, y) => y.b - x.b || y.c.wins - x.c.wins || x.c.created_at - y.c.created_at).slice(0, 25)
        .map((x) => Object.assign({}, x.c, { best: x.b }));
    } else return sendJson(res, 400, { error: 'Lista no válida.' });
    return sendJson(res, 200, { type, clans: list.map((c) => clanPublic(c, { best: c.best })) });
  }

  if (req.method === 'GET' && pathname === '/api/clan') {
    const c = q.clanById.get(parseInt(urlq.searchParams.get('id'), 10) || 0);
    if (!c) return sendJson(res, 404, { error: 'Ese clan no existe.' });
    const me = currentPlayer(req);
    const mine = me ? q.memberOf.get(me.id) : null;
    const isLeader = !!(mine && mine.clan_id === c.id && mine.role === 'leader');
    const canRecruit = !!(mine && mine.clan_id === c.id && CAN_RECRUIT.includes(mine.role));
    const rank = rankFor(c);
    // Historial de puesto: se actualiza al consultar el clan (último = puesto anterior distinto al actual)
    let cur = c.cur_rank, last = c.last_rank, best = c.best_rank, worst = c.worst_rank;
    if (rank !== null && cur !== rank) { last = cur || rank; cur = rank; best = best ? Math.min(best, rank) : rank; worst = Math.max(worst, rank); q.setRankHist.run(cur, last, best, worst, c.id); }
    let run = 0, bestS = 0, worstS = 0;
    for (const h of q.clanHist.all(c.id, c.id)) {
      if (h.winner_id === c.id) run = run > 0 ? run + 1 : 1; else run = run < 0 ? run - 1 : -1;
      bestS = Math.max(bestS, run); worstS = Math.min(worstS, run);
    }
    return sendJson(res, 200, {
      clan: clanPublic(c, {
        trophies: q.trophiesOf.all(c.id).map((t) => ({ seasonId: t.sid, season: seasonLabel(t.name, t.stage), place: t.rank })),
        rank, unranked: rank === null, rankInfo: { members: q.clanElig.get(c.id).n, minMembers: MIN_RANK_MEMBERS, wins: c.wins, winsToRank: RANK_WINS }, hist: { now: rank, last, best, worst }, bestStreak: bestS, worstStreak: worstS,
        members: q.clanMembers.all(c.id).map((m) => {
          const rec = playerRec(m.id);
          const n = (side) => { const r = rec.find((x) => x.side === side); return r ? Number(r.n) : 0; };
          return { id: m.id, alias: m.alias, role: m.role, joined: m.joined_at, wins: n('winner'), losses: n('loser') };
        }),
        invited: canRecruit ? q.invitesOf.all(c.id).map((r) => r.alias) : undefined,
      }),
      isMember: !!(mine && mine.clan_id === c.id), isLeader, canRecruit,
    });
  }

  if (req.method === 'GET' && pathname === '/api/my') {
    const me = currentPlayer(req);
    if (!me) return sendJson(res, 401, { error: 'Inicia sesión.' });
    const m = q.memberOf.get(me.id);
    const pf = q.playerFull.get(me.id), rec = playerRec(me.id);
    const rn = (side) => { const r = rec.find((x) => x.side === side); return r ? Number(r.n) : 0; };
    return sendJson(res, 200, {
      player: { id: pf.id, alias: pf.alias, joined: pf.created_at, logo: pf.logo, social: { steam: pf.steam, discord: pf.discord, twitch: pf.twitch, youtube: pf.youtube }, wins: rn('winner'), losses: rn('loser') },
      clan: m ? { id: m.clan_id, name: q.clanById.get(m.clan_id).name, role: m.role, joined: m.joined_at } : null,
      members: m && CAN_MATCH.includes(m.role) ? q.clanMembers.all(m.clan_id).map((x) => ({ id: x.id, alias: x.alias })) : [],
      toConfirm: m && CAN_MATCH.includes(m.role) ? q.toConfirm.all(m.clan_id).map((r) => ({ id: r.id, clanId: r.cid, clan: r.name, at: r.created_at, comment: r.report_comment, maps: [r.map1, r.map2].filter(Boolean), players: q.matchPlayers.all(r.id, 'loser').map((p) => p.alias) })) : [],
      reported: m && CAN_MATCH.includes(m.role) ? q.reportedBy.all(m.clan_id).map((r) => ({ id: r.id, clanId: r.cid, clan: r.name, at: r.created_at })) : [],
      invites: q.invitesFor.all(me.id).map((i) => ({ id: i.id, name: i.name })),
    });
  }



  // IDs de jugadores marcados: deben ser miembros actuales del clan indicado (1 a 12, sin repetir).
  const pickPlayers = (raw, clanId) => {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CLAN_MEMBERS) return null;
    const ids = [...new Set(raw.map((x) => parseInt(x, 10)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
    for (const id of ids) { const mm = q.memberOf.get(id); if (!mm || mm.clan_id !== clanId) return null; }
    return ids;
  };
  const commentOf = (v) => clean(v, 300);

  /* ----- Partidos: el perdedor reporta la derrota y el ganador la confirma ----- */
  if (req.method === 'GET' && pathname === '/api/matches') {
    const cid = parseInt(urlq.searchParams.get('clan'), 10) || 0;
    const page = Math.max(1, Math.min(100000, parseInt(urlq.searchParams.get('page'), 10) || 1));
    const per = 25;
    const rows = cid ? q.recentMatchesOf.all(cid, cid) : q.recentMatches.all(per, (page - 1) * per);
    return sendJson(res, 200, {
      total: cid ? rows.length : q.matchCount.get().n, page, per,
      matches: rows.map((r) => ({ id: r.id, at: r.resolved_at, winnerId: r.wid, winner: r.wname, loserId: r.lid, loser: r.lname, season: seasonLabel(r.sname, r.sstage) })),
    });
  }


  if (req.method === 'GET' && pathname === '/api/links') {
    return sendJson(res, 200, { links: db.prepare('SELECT id, title, url, image FROM site_links ORDER BY sort, id').all() });
  }
  if (req.method === 'GET' && pathname === '/api/downloads') {
    const rows = db.prepare('SELECT id, title, url, category, description, info FROM downloads ORDER BY sort, id').all();
    return sendJson(res, 200, { categories: DL_CATS, downloads: rows });
  }
  if (req.method === 'GET' && pathname === '/api/news') {
    const cat = NEWS_CATS[urlq.searchParams.get('cat')] ? urlq.searchParams.get('cat') : '';
    const page = Math.max(1, Math.min(10000, parseInt(urlq.searchParams.get('page'), 10) || 1)), per = 10;
    const limit = Math.min(20, parseInt(urlq.searchParams.get('limit'), 10) || per);
    const where = 'published = 1' + (cat ? ' AND category = ?' : '');
    const args = cat ? [cat] : [];
    const total = db.prepare('SELECT COUNT(*) AS n FROM news WHERE ' + where).get(...args).n;
    const rows = db.prepare('SELECT * FROM news WHERE ' + where + ' ORDER BY pinned DESC, created_at DESC, id DESC LIMIT ? OFFSET ?').all(...args, limit, (page - 1) * limit);
    return sendJson(res, 200, { total, page, per: limit, news: rows.map((r) => newsOut(r, false)) });
  }
  if (req.method === 'GET' && pathname === '/api/news/item') {
    const r = db.prepare('SELECT * FROM news WHERE id = ? AND published = 1').get(parseInt(urlq.searchParams.get('id'), 10) || 0);
    if (!r) return sendJson(res, 404, { error: 'Esa noticia no existe.' });
    return sendJson(res, 200, { item: newsOut(r, true) });
  }
  if (req.method === 'GET' && pathname === '/api/servers') return sendJson(res, 200, await serversMod.list());
  if (req.method === 'GET' && pathname === '/api/live') return sendJson(res, 200, await getLive());
  if (req.method === 'GET' && pathname === '/api/maps') return sendJson(res, 200, { groups: MAP_GROUPS });

  if (req.method === 'GET' && pathname === '/api/match') {
    const m = q.matchFull.get(parseInt(urlq.searchParams.get('id'), 10) || 0);
    if (!m || m.status !== 'confirmed') return sendJson(res, 404, { error: 'Ese partido no existe.' });
    const side = (cid, name, who, at, comment, kind) => {
      const c = q.clanById.get(cid);
      return {
        id: cid, name, rank: c ? rankFor(c) : null,
        by: who || '', at, comment, members: q.matchPlayers.all(m.id, kind).map((x) => x.alias),
      };
    };
    return sendJson(res, 200, {
      match: {
        id: m.id, at: m.resolved_at, season: seasonLabel(m.sname, m.sstage),
        maps: [m.map1, m.map2].filter(Boolean),
        winner: side(m.winner_id, m.wname, m.confirmer, m.resolved_at, m.confirm_comment, 'winner'),
        loser: side(m.loser_id, m.lname, m.reporter, m.created_at, m.report_comment, 'loser'),
      },
    });
  }

  if (req.method === 'POST' && pathname === '/api/match/report') {
    const p = needPlayer(); if (!p) return;
    const mine = myMatchClan(p); if (!mine) return;
    { const blk = panel.competeBlock(p.id, mine); if (blk) return sendJson(res, 403, { error: blk }); }
    if (isLimited(req, 'report', 20)) return sendJson(res, 429, { error: 'Demasiados reportes. Prueba más tarde.' });
    addHit(req, 'report', 60 * 60 * 1000);
    const b = await readJson(req);
    const seaNow = q.activeSeason.get();
    if (!seaNow) return sendJson(res, 409, { error: 'No hay una temporada activa. El administrador debe crear una.' });
    const rid = parseInt(b.opponentId, 10);
    const rival = Number.isSafeInteger(rid) && rid > 0 ? q.clanIdName.get(rid) : null;
    if (!rival) return sendJson(res, 404, { error: 'No existe un clan con esa ID.' });
    if (rival.id === mine) return sendJson(res, 400, { error: 'No puedes reportar un partido contra tu propio clan.' });
    if (panel.clanBlocked(rival.id)) return sendJson(res, 409, { error: 'Ese clan está suspendido del ladder por la administración.' });
    if (q.pendingPair.get(mine, rival.id, rival.id, mine)) return sendJson(res, 409, { error: 'Ya hay un reporte pendiente entre estos dos clanes.' });
    if (q.pendingByLoser.get(mine).n >= 5) return sendJson(res, 409, { error: 'Tienes demasiados reportes pendientes de confirmar.' });
    const played = pickPlayers(b.players, mine);
    if (!played) return sendJson(res, 400, { error: 'Marca al menos un jugador de tu clan que jugó el partido.' });
    const map1 = clean(b.map1, 60), map2 = clean(b.map2, 60);
    if (!MAP_SET.has(map1) || !MAP_SET.has(map2)) return sendJson(res, 400, { error: 'Elige los dos mapas que se jugaron.' });
    try {
      db.exec('BEGIN');
      const at = Date.now();
      const mid = Number(q.insertMatch.run(rival.id, mine, p.id, at, commentOf(b.comment), seaNow.id).lastInsertRowid);
      db.prepare('UPDATE matches SET map1 = ?, map2 = ? WHERE id = ?').run(map1, map2, mid);
      for (const id of played) q.insertMatchPlayer.run(mid, id, 'loser');
      // La derrota cuenta desde el momento del reporte; el ganador suma su victoria al confirmar.
      const lc = q.clanById.get(mine);
      q.markLoss.run(lc.streak, lc.last_match, lc.streak < 0 ? lc.streak - 1 : -1, mid);
      q.addLoss.run(at, mine);
      panel.recompute();
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } return sendJson(res, 500, { error: 'No se pudo guardar el reporte.' }); }
    return sendJson(res, 201, { ok: true, opponent: rival.name });
  }

  if (req.method === 'POST' && (pathname === '/api/match/confirm' || pathname === '/api/match/reject' || pathname === '/api/match/cancel')) {
    const p = needPlayer(); if (!p) return;
    const mine = myMatchClan(p); if (!mine) return;
    { const blk = panel.competeBlock(p.id, mine); if (blk) return sendJson(res, 403, { error: blk }); }
    const b = await readJson(req);
    const m = q.matchById.get(parseInt(b.matchId, 10) || 0);
    if (!m || m.status !== 'pending') return sendJson(res, 404, { error: 'Ese reporte ya no está pendiente.' });
    const now = Date.now();
    const revert = () => {
      const r = q.setMatch.run(pathname === '/api/match/cancel' ? 'cancelled' : 'rejected', now, m.id);
      if (Number(r.changes) === 1) panel.recompute();
    };
    if (pathname === '/api/match/cancel') {
      if (m.loser_id !== mine) return sendJson(res, 403, { error: 'Solo quien reportó puede cancelarlo.' });
      try { db.exec('BEGIN'); revert(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } return sendJson(res, 500, { error: 'No se pudo cancelar.' }); }
      return sendJson(res, 200, { ok: true });
    }
    if (m.winner_id !== mine) return sendJson(res, 403, { error: 'Solo el líder del clan ganador puede responder este reporte.' });
    if (pathname === '/api/match/reject') {
      try { db.exec('BEGIN'); revert(); db.exec('COMMIT'); } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } return sendJson(res, 500, { error: 'No se pudo rechazar.' }); }
      return sendJson(res, 200, { ok: true });
    }
    const got = pickPlayers(b.players, mine);
    if (!got) return sendJson(res, 400, { error: 'Marca al menos un jugador de tu clan que recibirá los puntos.' });
    try {
      db.exec('BEGIN');
      const r = q.confirmMatch.run(now, commentOf(b.comment), p.id, m.id);
      if (Number(r.changes) !== 1) throw new Error('ya resuelto');
      for (const id of got) q.insertMatchPlayer.run(m.id, id, 'winner');
      q.addWin.run(now, m.winner_id);
      if (!m.loss_applied) q.addLoss.run(now, m.loser_id); // reportes anteriores a este cambio
      panel.recompute();
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } return sendJson(res, 409, { error: 'No se pudo confirmar.' }); }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/my/social') {
    const p = needPlayer(); if (!p) return;
    if (isLimited(req, 'social', 30)) return sendJson(res, 429, { error: 'Demasiados cambios. Prueba más tarde.' });
    addHit(req, 'social', 60 * 60 * 1000);
    const b = await readJson(req);
    const vals = {};
    const names = { steam: 'Steam', discord: 'Discord', twitch: 'Twitch', youtube: 'YouTube' };
    for (const k of Object.keys(SOCIAL)) {
      const v = socialValue(k, b[k]);
      if (v === null) return sendJson(res, 400, { error: 'El dato de ' + names[k] + ' no es válido. Escribe tu usuario o el enlace de tu perfil de ' + names[k] + '.' });
      vals[k] = v;
    }
    db.prepare('UPDATE players SET steam = ?, discord = ?, twitch = ?, youtube = ? WHERE id = ?').run(vals.steam, vals.discord, vals.twitch, vals.youtube, p.id);
    return sendJson(res, 200, { ok: true, social: vals });
  }

  if (req.method === 'POST' && pathname === '/api/clan/create') {
    const p = needPlayer(); if (!p) return;
    if (isLimited(req, 'clan', 10)) return sendJson(res, 429, { error: 'Demasiados intentos. Prueba más tarde.' });
    addHit(req, 'clan', 60 * 60 * 1000);
    { const blk = panel.competeBlock(p.id, 0); if (blk) return sendJson(res, 403, { error: blk }); }
    const b = await readJson(req);
    const name = clean(b.name, 60), tag = clean(b.tag, 20);
    const website = httpUrl(b.website), logo = httpUrl(b.logo);
    if (name.length < 3 || name.length > 30) return sendJson(res, 400, { error: 'El nombre del clan debe tener entre 3 y 30 caracteres.' });
    if (tag.length > 8) return sendJson(res, 400, { error: 'El tag puede tener hasta 8 caracteres.' });
    if (website === null || logo === null) return sendJson(res, 400, { error: 'Los enlaces deben empezar con http:// o https://.' });
    if (q.memberOf.get(p.id)) return sendJson(res, 409, { error: 'Ya perteneces a un clan. Sal de él primero.' });
    let id;
    try {
      db.exec('BEGIN');
      id = Number(q.insertClan.run(name, tag, website, logo, Date.now()).lastInsertRowid);
      q.insertMember.run(id, p.id, 'leader', Date.now());
      q.deleteInvitesOfPlayer.run(p.id);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ }
      return sendJson(res, 409, { error: 'Ya existe un clan con ese nombre.' });
    }
    return sendJson(res, 201, { clan: { id, name } });
  }

  if (req.method === 'POST' && pathname === '/api/clan/edit') {
    const p = needPlayer(); if (!p) return;
    const cid = myLeaderClan(p); if (!cid) return;
    const b = await readJson(req);
    const name = clean(b.name, 60), tag = clean(b.tag, 20);
    const website = httpUrl(b.website), logo = httpUrl(b.logo);
    if (name.length < 3 || name.length > 30) return sendJson(res, 400, { error: 'El nombre del clan debe tener entre 3 y 30 caracteres.' });
    if (tag.length > 8) return sendJson(res, 400, { error: 'El tag puede tener hasta 8 caracteres.' });
    if (website === null || logo === null) return sendJson(res, 400, { error: 'Los enlaces deben empezar con http:// o https://.' });
    const ROLES = ['leader', 'coleader', 'captain', 'member'];
    const changes = [];
    if (b.roles && typeof b.roles === 'object') {
      const ids = Object.keys(b.roles).slice(0, 200);
      const members = q.clanMembers.all(cid);
      const next = new Map(members.map((x) => [x.id, x.role]));
      for (const k of ids) {
        const pid = parseInt(k, 10), role = b.roles[k];
        if (!next.has(pid) || !ROLES.includes(role)) return sendJson(res, 400, { error: 'Rango no válido.' });
        if (next.get(pid) !== role) { next.set(pid, role); changes.push([role, pid]); }
      }
      if (![...next.values()].includes('leader')) return sendJson(res, 400, { error: 'El clan debe tener al menos un Líder.' });
    }
    try {
      db.exec('BEGIN');
      q.updateClan.run(name, tag, website, logo, cid);
      for (const [role, pid] of changes) q.setRole.run(role, cid, pid);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ }
      return sendJson(res, 409, { error: 'Ya existe un clan con ese nombre.' });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/clan/invite') {
    const p = needPlayer(); if (!p) return;
    const cid = myRecruitClan(p); if (!cid) return;
    const b = await readJson(req);
    const pid = parseInt(b.playerId, 10);
    const target = Number.isSafeInteger(pid) && pid > 0 ? q.playerIdOnly.get(pid) : null;
    if (!target) return sendJson(res, 404, { error: 'No existe un jugador con esa ID.' });
    if (q.memberOf.get(target.id)) return sendJson(res, 409, { error: 'Ese jugador ya está en un clan.' });
    if (q.memberCount.get(cid).n >= MAX_CLAN_MEMBERS) return sendJson(res, 409, { error: 'El clan está lleno.' });
    if (q.inviteCount.get(cid).n >= MAX_CLAN_INVITES) return sendJson(res, 409, { error: 'Hay demasiadas invitaciones pendientes.' });
    q.insertInvite.run(cid, target.id, Date.now());
    return sendJson(res, 200, { ok: true, alias: target.alias });
  }

  if (req.method === 'POST' && pathname === '/api/clan/uninvite') {
    const p = needPlayer(); if (!p) return;
    const cid = myRecruitClan(p); if (!cid) return;
    const b = await readJson(req);
    const target = q.playerIdByAlias.get(clean(b.alias, 40));
    if (target) q.deleteInvite.run(cid, target.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && (pathname === '/api/clan/accept' || pathname === '/api/clan/decline')) {
    const p = needPlayer(); if (!p) return;
    const b = await readJson(req);
    const cid = parseInt(b.clanId, 10) || 0;
    if (!q.hasInvite.get(cid, p.id)) return sendJson(res, 404, { error: 'Esa invitación ya no existe.' });
    if (pathname === '/api/clan/decline') { q.deleteInvite.run(cid, p.id); return sendJson(res, 200, { ok: true }); }
    { const blk = panel.competeBlock(p.id, 0); if (blk) return sendJson(res, 403, { error: blk }); }
    if (q.memberOf.get(p.id)) return sendJson(res, 409, { error: 'Ya perteneces a un clan.' });
    if (q.memberCount.get(cid).n >= MAX_CLAN_MEMBERS) return sendJson(res, 409, { error: 'El clan está lleno.' });
    try {
      db.exec('BEGIN');
      q.insertMember.run(cid, p.id, 'member', Date.now());
      q.deleteInvitesOfPlayer.run(p.id);
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } return sendJson(res, 409, { error: 'No se pudo unir al clan.' }); }
    return sendJson(res, 200, { ok: true, clanId: cid });
  }

  if (req.method === 'POST' && pathname === '/api/clan/leave') {
    const p = needPlayer(); if (!p) return;
    const m = q.memberOf.get(p.id);
    if (!m) return sendJson(res, 409, { error: 'No perteneces a ningún clan.' });
    if (m.role === 'leader') {
      const otherLeader = q.clanMembers.all(m.clan_id).some((x) => x.role === 'leader' && x.id !== p.id);
      if (!otherLeader && q.memberCount.get(m.clan_id).n > 1) return sendJson(res, 409, { error: 'Eres el único Líder: dale el rango de Líder a otro miembro (en Editor) antes de salir.' });
      if (otherLeader) { q.deleteMember.run(m.clan_id, p.id); return sendJson(res, 200, { ok: true }); }
      q.deleteClan.run(m.clan_id);
      return sendJson(res, 200, { ok: true, disbanded: true });
    }
    q.deleteMember.run(m.clan_id, p.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && (pathname === '/api/clan/kick' || pathname === '/api/clan/transfer')) {
    const p = needPlayer(); if (!p) return;
    const cid = myLeaderClan(p); if (!cid) return;
    const b = await readJson(req);
    const target = q.playerIdByAlias.get(clean(b.alias, 40));
    const tm = target ? q.memberOf.get(target.id) : null;
    if (!tm || tm.clan_id !== cid || target.id === p.id) return sendJson(res, 404, { error: 'Ese jugador no es otro miembro de tu clan.' });
    if (pathname === '/api/clan/kick') {
      if (tm.role === 'leader') return sendJson(res, 409, { error: 'No puedes expulsar a un Líder. Cámbiale el rango primero.' });
      q.deleteMember.run(cid, target.id);
    }
    else {
      try { db.exec('BEGIN'); q.setRole.run('leader', cid, target.id); q.setRole.run('member', cid, p.id); db.exec('COMMIT'); }
      catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } return sendJson(res, 500, { error: 'No se pudo traspasar.' }); }
    }
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'No encontrado.' });
}

/* ---------- Archivos estáticos ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { res.writeHead(400); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  const inside = file.startsWith(PUBLIC_DIR + path.sep);
  const hidden = rel.split('/').some((seg) => seg.startsWith('.'));
  if (!inside || hidden) { res.writeHead(404); return res.end('No encontrado'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- Servidor ---------- */
// Flechas del ranking: tras cada cambio de resultados se compara el puesto de cada clan con el anterior
const lastRanks = new Map();
function refreshTrend() {
  const ids = q.rankIds.all().map((r) => r.id);
  ids.forEach((id, i) => {
    const rank = i + 1, prev = lastRanks.get(id);
    if (prev !== undefined && prev !== rank) q.setTrend.run(rank < prev ? 1 : -1, id);
    lastRanks.set(id, rank);
  });
  for (const id of [...lastRanks.keys()]) if (!ids.includes(id)) lastRanks.delete(id);
}
refreshTrend();

// Cierre de temporada: guarda la tabla final (los 3 primeros reciben copa), cancela lo pendiente y deja el ladder en cero
function closeSeason(by) {
  const sea = q.activeSeason.get();
  if (!sea) return null;
  try {
    db.exec('BEGIN');
    const now = Date.now();
    q.rankedForClose.all().forEach((c, i) => q.insertResult.run(sea.id, i + 1, c.id, c.name, c.wins, c.losses, c.streak));
    q.cancelPending.run(now);
    q.closeSeasonRow.run(now, by, sea.id);
    q.resetClans.run();
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ }
    throw e;
  }
  lastRanks.clear(); refreshTrend();
  return sea.id;
}
function checkSeasonDeadline() {
  const sea = q.activeSeason.get();
  if (sea && sea.ends_at > 0 && sea.ends_at <= Date.now()) { closeSeason('automático (plazo cumplido)'); console.log('Temporada cerrada por plazo: ' + seasonLabel(sea.name, sea.stage)); }
}
try { checkSeasonDeadline(); } catch (e) { console.error(e); }
setInterval(() => { try { checkSeasonDeadline(); } catch (e) { console.error(e); } }, 60 * 1000).unref();

const server = http.createServer(async (req, res) => {
  securityHeaders(req, res);
  if (req.method === 'POST') res.on('finish', () => { try { refreshTrend(); } catch (e) { console.error(e); } });
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
    else serveStatic(req, res, pathname);
  } catch (e) {
    if (e && e.status) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Error del servidor.' });
  }
});

server.listen(PORT, () => {
  console.log('Ladder en marcha: http://localhost:' + PORT);
  require('./backup').start(db);
});
// Al apagarse (reinicio, nuevo despliegue o hosting que duerme la página) se guarda un respaldo antes de salir
let apagando = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (apagando) return; apagando = true;
    const fin = () => process.exit(0);
    setTimeout(fin, 20000).unref();
    require('./backup').backupNow(db).then(fin, fin);
  });
}
