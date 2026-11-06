'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
/*
 * Panel de administración (partes 1 y 2): roles y permisos, auditoría inmutable,
 * dashboard y gestión de partidos con recálculo de estadísticas.
 * Se carga desde server.js. Sin dependencias externas.
 */

const ROLES = ['moderator', 'admin', 'superadmin', 'news'];
const ROLE_LABEL = { news: 'Encargado de noticias', moderator: 'Moderador', admin: 'Administrador', superadmin: 'Superadministrador' };

// Permisos por rol. El superadministrador tiene todos.
const PERMS = {
  news: ['news.manage'],
  moderator: ['panel.view', 'matches.view', 'audit.view', 'reports.review', 'evidence.view', 'evidence.add', 'players.view', 'clans.view', 'sanctions.view', 'sanctions.warn', 'complaints.manage', 'disc.view'],
  admin: ['panel.view', 'matches.view', 'matches.edit', 'matches.delete', 'audit.view', 'seasons.manage', 'reports.review', 'evidence.view', 'evidence.add', 'config.edit', 'players.view', 'players.edit', 'stats.adjust', 'clans.view', 'clans.edit', 'sanctions.view', 'sanctions.warn', 'sanctions.apply', 'sanctions.revoke', 'appeals.resolve', 'complaints.manage', 'disc.view', 'disc.manage', 'news.manage'],
  superadmin: ['*'],
};

const MATCH_STATUS = ['pending', 'disputed', 'confirmed', 'rejected', 'annulled', 'cancelled', 'deleted'];
const SETTABLE = ['pending', 'disputed', 'confirmed', 'rejected', 'annulled'];

/* Se ejecuta antes de preparar las consultas del servidor: solo agrega, nunca borra. */
function srvIp(v) {
  const s = String(v == null ? '' : v).trim().slice(0, 60);
  if (!s) return '';
  return /^[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(s) ? s : null;
}
function migrate(db) {
  const has = (t, c) => db.prepare('PRAGMA table_info(' + t + ')').all().some((x) => x.name === c);
  const add = (t, c, def) => { if (!has(t, c)) db.exec('ALTER TABLE ' + t + ' ADD COLUMN ' + c + ' ' + def); };
  add('players', 'admin_role', "TEXT NOT NULL DEFAULT ''");
  add('players', 'active', 'INTEGER NOT NULL DEFAULT 1');
  for (const c of ['steam', 'discord', 'twitch', 'youtube']) add('players', c, "TEXT NOT NULL DEFAULT ''");
  add('matches', 'played_at', 'INTEGER NOT NULL DEFAULT 0');
  add('matches', 'score_w', 'INTEGER NOT NULL DEFAULT -1');
  add('matches', 'score_l', 'INTEGER NOT NULL DEFAULT -1');
  add('matches', 'map1', "TEXT NOT NULL DEFAULT ''");
  add('matches', 'map2', "TEXT NOT NULL DEFAULT ''");
  add('matches', 'mode', "TEXT NOT NULL DEFAULT ''");
  add('matches', 'rev', 'INTEGER NOT NULL DEFAULT 0');
  add('matches', 'prev_status', "TEXT NOT NULL DEFAULT ''");
  add('matches', 'report_state', "TEXT NOT NULL DEFAULT ''");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          INTEGER NOT NULL,
      actor_id    INTEGER NOT NULL DEFAULT 0,
      actor_alias TEXT NOT NULL DEFAULT '',
      actor_role  TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id   INTEGER NOT NULL DEFAULT 0,
      player_id   INTEGER NOT NULL DEFAULT 0,
      clan_id     INTEGER NOT NULL DEFAULT 0,
      match_id    INTEGER NOT NULL DEFAULT 0,
      old_json    TEXT NOT NULL DEFAULT '',
      new_json    TEXT NOT NULL DEFAULT '',
      reason      TEXT NOT NULL DEFAULT '',
      result      TEXT NOT NULL DEFAULT 'ok',
      ip          TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS audit_at ON audit_log(at);
    CREATE INDEX IF NOT EXISTS audit_match ON audit_log(match_id);
    CREATE INDEX IF NOT EXISTS audit_player ON audit_log(player_id);
    CREATE INDEX IF NOT EXISTS audit_clan ON audit_log(clan_id);
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'El historial de auditoría no se puede modificar'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
      BEGIN SELECT RAISE(ABORT, 'El historial de auditoría no se puede borrar'); END;
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL,
      kind TEXT NOT NULL, ref TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
      by_id INTEGER NOT NULL DEFAULT 0, by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS evidence_owner ON evidence(owner_type, owner_id);
    CREATE TABLE IF NOT EXISTS admin_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
      body TEXT NOT NULL, by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_notes_target ON admin_notes(target_type, target_id);
    CREATE TABLE IF NOT EXISTS sanction_reasons (code TEXT PRIMARY KEY, label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sanctions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, player_id INTEGER NOT NULL DEFAULT 0, clan_id INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL, reason_code TEXT NOT NULL, description TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'leve', rules TEXT NOT NULL DEFAULT '',
      match_id INTEGER NOT NULL DEFAULT 0, complaint_id INTEGER NOT NULL DEFAULT 0, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active', appealable INTEGER NOT NULL DEFAULT 1, appeal_text TEXT NOT NULL DEFAULT '', appeal_at INTEGER NOT NULL DEFAULT 0,
      appeal_status TEXT NOT NULL DEFAULT '', appeal_resolution TEXT NOT NULL DEFAULT '', pts INTEGER NOT NULL DEFAULT 0, adjust_id INTEGER NOT NULL DEFAULT 0,
      prev_match_status TEXT NOT NULL DEFAULT '', by_id INTEGER NOT NULL DEFAULT 0, by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sanctions_player ON sanctions(player_id, status);
    CREATE INDEX IF NOT EXISTS sanctions_clan ON sanctions(clan_id, status);
    CREATE TABLE IF NOT EXISTS sanction_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sanction_id INTEGER NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL, old_json TEXT NOT NULL DEFAULT '', new_json TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS sanction_history_s ON sanction_history(sanction_id);
    CREATE TRIGGER IF NOT EXISTS sh_no_update BEFORE UPDATE ON sanction_history BEGIN SELECT RAISE(ABORT, 'El historial de sanciones no se puede modificar'); END;
    CREATE TRIGGER IF NOT EXISTS sh_no_delete BEFORE DELETE ON sanction_history BEGIN SELECT RAISE(ABORT, 'El historial de sanciones no se puede borrar'); END;
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT, accuser_id INTEGER NOT NULL DEFAULT 0, accused_id INTEGER NOT NULL, match_id INTEGER NOT NULL DEFAULT 0,
      incident_at INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', resolution TEXT NOT NULL DEFAULT '',
      sanction_id INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS complaints_accused ON complaints(accused_id);
    CREATE TABLE IF NOT EXISTS disc_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, clan_id INTEGER NOT NULL, leader_id INTEGER NOT NULL, match_id INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL, description TEXT NOT NULL, incident_at INTEGER NOT NULL DEFAULT 0, severity TEXT NOT NULL DEFAULT 'leve',
      deadline_at INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', resolution TEXT NOT NULL DEFAULT '', measures TEXT NOT NULL DEFAULT '',
      leader_response TEXT NOT NULL DEFAULT '', responded_at INTEGER NOT NULL DEFAULT 0, notified_at INTEGER NOT NULL DEFAULT 0,
      by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS disc_clan ON disc_reports(clan_id);
    CREATE TABLE IF NOT EXISTS match_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL, kind TEXT NOT NULL,
      body TEXT NOT NULL, by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notes_match ON match_notes(match_id);
    CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS clan_adjust (
      id INTEGER PRIMARY KEY AUTOINCREMENT, clan_id INTEGER NOT NULL, season_id INTEGER NOT NULL,
      wins_delta INTEGER NOT NULL DEFAULT 0, losses_delta INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL, by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      revoked_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS player_adjust (
      id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL, season_id INTEGER NOT NULL,
      wins_delta INTEGER NOT NULL DEFAULT 0, losses_delta INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL, by_alias TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
      revoked_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  add('admin_notes', 'public', 'INTEGER NOT NULL DEFAULT 0');
  add('complaints', 'server_ip', "TEXT NOT NULL DEFAULT ''");
  const seed = db.prepare('INSERT OR IGNORE INTO sanction_reasons (code, label, sort) VALUES (?,?,?)');
  [['cheats', 'Uso comprobado de cheats o trampas'], ['programs', 'Uso de programas no permitidos'], ['exploit', 'Abuso de errores del juego'], ['conduct', 'Conducta antideportiva'],
   ['harassment', 'Insultos, acoso o amenazas'], ['impersonation', 'Suplantación de identidad'], ['manipulation', 'Manipulación de resultados'], ['falsified', 'Falsificación de capturas o evidencias'],
   ['repeated', 'Incumplimiento reiterado de las reglas'], ['other', 'Otras infracciones']].forEach((r, i) => seed.run(r[0], r[1], i));
}

function init(ctx) {
  const { db, ADMINS, currentPlayer, sendJson, readJson, clean, isLimited, addHit, clientIp, q, DATA_DIR, CAN_MATCH } = ctx;
  const EVDIR = path.join(DATA_DIR, 'evidence');
  fs.mkdirSync(EVDIR, { recursive: true });

  const st = {
    audit: db.prepare('INSERT INTO audit_log (at, actor_id, actor_alias, actor_role, action, target_type, target_id, player_id, clan_id, match_id, old_json, new_json, reason, result, ip) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    roleOf: db.prepare('SELECT admin_role FROM players WHERE id = ?'),
    cfg: db.prepare('SELECT value FROM config WHERE key = ?'),
    idem: db.prepare('INSERT OR IGNORE INTO idem (key, at) VALUES (?,?)'),
    matchRow: db.prepare('SELECT * FROM matches WHERE id = ?'),
    sidePlayers: db.prepare('SELECT p.id, p.alias FROM match_players mp JOIN players p ON p.id = mp.player_id WHERE mp.match_id = ? AND mp.side = ? ORDER BY p.alias COLLATE NOCASE'),
    delSide: db.prepare('DELETE FROM match_players WHERE match_id = ? AND side = ?'),
    addSide: db.prepare('INSERT OR IGNORE INTO match_players (match_id, player_id, side) VALUES (?,?,?)'),
    flipSides: db.prepare("UPDATE match_players SET side = CASE side WHEN 'winner' THEN 'loser' ELSE 'winner' END WHERE match_id = ?"),
    playerExists: db.prepare('SELECT id, alias FROM players WHERE id = ?'),
    clanAdjust: db.prepare('SELECT clan_id, SUM(wins_delta) AS w, SUM(losses_delta) AS l FROM clan_adjust WHERE season_id = ? AND revoked_at = 0 GROUP BY clan_id'),
    playerAdjustOf: db.prepare('SELECT COALESCE(SUM(wins_delta),0) AS w, COALESCE(SUM(losses_delta),0) AS l FROM player_adjust WHERE player_id = ? AND season_id = (SELECT id FROM seasons WHERE status = \'active\') AND revoked_at = 0'),
    matchesForStats: db.prepare("SELECT id, winner_id, loser_id, status, created_at, resolved_at, played_at FROM matches WHERE season_id = ? AND status IN ('pending','confirmed','disputed')"),
    allClanIds: db.prepare('SELECT id FROM clans'),
    setClanStats: db.prepare('UPDATE clans SET wins = ?, losses = ?, streak = ?, last_match = ? WHERE id = ?'),
    staff: db.prepare("SELECT id, alias, admin_role FROM players WHERE admin_role <> '' ORDER BY alias COLLATE NOCASE"),
    playerByAlias: db.prepare('SELECT id, alias, admin_role FROM players WHERE alias = ?'),
    setRole: db.prepare('UPDATE players SET admin_role = ? WHERE id = ?'),
    evOf: db.prepare('SELECT * FROM evidence WHERE owner_type = ? AND owner_id = ? ORDER BY id'),
    evById: db.prepare('SELECT * FROM evidence WHERE id = ?'),
    evCount: db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE owner_type = ? AND owner_id = ?'),
    evAdd: db.prepare('INSERT INTO evidence (owner_type, owner_id, kind, ref, label, mime, size, by_id, by_alias, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    notesOf: db.prepare('SELECT * FROM match_notes WHERE match_id = ? ORDER BY id'),
    noteCount: db.prepare('SELECT COUNT(*) AS n FROM match_notes WHERE match_id = ?'),
    noteAdd: db.prepare('INSERT INTO match_notes (match_id, kind, body, by_alias, created_at) VALUES (?,?,?,?,?)'),
    memberOf: db.prepare('SELECT clan_id, role FROM clan_members WHERE player_id = ?'),
    cfgSet: db.prepare('INSERT INTO config (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  const playerById = (id) => db.prepare('SELECT id, alias FROM players WHERE id = ?').get(id);
  const config = (k, d) => { const r = st.cfg.get(k); return r ? r.value : d; };
  const serversCfg = require('./servers').create(db);

  /* ---------- Roles y permisos (siempre leídos de la base de datos, nunca de la sesión ni del cliente) ---------- */
  function roleOf(p) {
    if (!p) return '';
    if (ADMINS.has(String(p.alias).toLowerCase())) return 'superadmin';
    const r = st.roleOf.get(p.id);
    return r && ROLES.includes(r.admin_role) ? r.admin_role : '';
  }
  function can(p, perm) {
    const role = roleOf(p);
    if (!role) return false;
    const list = PERMS[role] || [];
    return list.includes('*') || list.includes(perm);
  }
  const permsOf = (p) => { const role = roleOf(p); const l = PERMS[role] || []; return l.includes('*') ? ['*'] : l; };

  /* ---------- Auditoría ---------- */
  function audit(actor, action, info, oldV, newV, reason, result, req) {
    info = info || {};
    const js = (v) => (v === undefined || v === null || v === '' ? '' : JSON.stringify(v));
    try {
      st.audit.run(Date.now(), actor ? actor.id : 0, actor ? actor.alias : 'sistema', actor ? roleOf(actor) : '', action,
        info.type || '', info.id || 0, info.player || 0, info.clan || 0, info.match || 0,
        js(oldV), js(newV), reason || '', result || 'ok', req ? clientIp(req) : '');
    } catch (e) { console.error('[auditoría]', e.message); }
  }

  function tx(fn) {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (_) { /* ya cerrada */ } throw e; }
  }

  /* ---------- Recálculo de estadísticas ----------
   * Victorias, derrotas y racha de cada clan se reconstruyen desde los partidos de la temporada activa
   * más los ajustes administrativos vigentes. Así editar, anular o eliminar un partido nunca duplica ni deja residuos.
   * Regla: la derrota cuenta desde el reporte (pendiente) y la victoria al validarse. */
  function recompute() {
    const sea = q.activeSeason.get();
    if (!sea) return;
    const disputeLoss = config('dispute_counts', 'loss') === 'loss';
    const ev = [];
    for (const m of st.matchesForStats.all(sea.id)) {
      if (m.status !== 'disputed' || disputeLoss) ev.push({ t: m.played_at || m.created_at, k: 0, id: m.id, clan: m.loser_id, win: false });
      if (m.status === 'confirmed') ev.push({ t: m.played_at || m.resolved_at || m.created_at, k: 1, id: m.id, clan: m.winner_id, win: true });
    }
    ev.sort((a, b) => a.t - b.t || a.k - b.k || a.id - b.id);
    const acc = new Map();
    for (const e of ev) {
      const c = acc.get(e.clan) || { w: 0, l: 0, s: 0, last: 0 };
      if (e.win) { c.w++; c.s = c.s > 0 ? c.s + 1 : 1; } else { c.l++; c.s = c.s < 0 ? c.s - 1 : -1; }
      c.last = e.t; acc.set(e.clan, c);
    }
    const adj = new Map(st.clanAdjust.all(sea.id).map((r) => [r.clan_id, r]));
    for (const { id } of st.allClanIds.all()) {
      const c = acc.get(id) || { w: 0, l: 0, s: 0, last: 0 };
      const a = adj.get(id);
      st.setClanStats.run(Math.max(0, c.w + (a ? Number(a.w) : 0)), Math.max(0, c.l + (a ? Number(a.l) : 0)), c.s, c.last, id);
    }
  }

  // Victorias y derrotas de un jugador (partidos de la temporada activa + ajustes vigentes).
  function playerRecord(pid, rows) {
    const a = st.playerAdjustOf.get(pid);
    const n = (side) => { const r = rows.find((x) => x.side === side); return r ? Number(r.n) : 0; };
    return [{ side: 'winner', n: Math.max(0, n('winner') + Number(a.w)) }, { side: 'loser', n: Math.max(0, n('loser') + Number(a.l)) }];
  }

  /* ---------- Utilidades ---------- */
  const int = (v, min, max) => { const n = Number(v); return Number.isSafeInteger(n) && n >= min && n <= max ? n : null; };
  const reasonOf = (b) => clean(b.reason, 500);
  const BAD_REASON = 'Escribe el motivo del cambio (al menos 5 caracteres).';
  const roster = (mid, side) => st.sidePlayers.all(mid, side).map((x) => ({ id: x.id, alias: x.alias }));
  const snapshot = (m) => ({
    estado: m.status, ganadorId: m.winner_id, perdedorId: m.loser_id,
    marcador: m.score_w >= 0 && m.score_l >= 0 ? m.score_w + '-' + m.score_l : '',
    fecha: m.played_at || m.resolved_at || m.created_at, modalidad: m.mode,
    ganadores: roster(m.id, 'winner').map((x) => x.alias), perdedores: roster(m.id, 'loser').map((x) => x.alias),
  });

  function matchView(m) {
    const w = q.clanById.get(m.winner_id), l = q.clanById.get(m.loser_id);
    const sea = q.seasonById.get(m.season_id);
    return {
      id: m.id, status: m.status, prevStatus: m.prev_status, rev: m.rev, reportState: m.report_state,
      winnerId: m.winner_id, winner: w ? w.name : '?', loserId: m.loser_id, loser: l ? l.name : '?',
      scoreW: m.score_w, scoreL: m.score_l, mode: m.mode,
      date: m.played_at || m.resolved_at || m.created_at, playedAt: m.played_at,
      createdAt: m.created_at, resolvedAt: m.resolved_at,
      season: sea ? sea.name + (sea.stage ? ' • ' + sea.stage : '') : '', seasonId: m.season_id,
      seasonActive: !!(sea && sea.status === 'active'),
    };
  }

  /* Valida y normaliza una lista de IDs de jugadores (existen, sin repetir, hasta 12). */
  function playersList(raw) {
    if (!Array.isArray(raw) || raw.length > 12) return null;
    const ids = [...new Set(raw.map((x) => parseInt(x, 10)))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0 || !st.playerExists.get(id))) return null;
    return ids;
  }

  /* ---------- Evidencias ---------- */
  const MAX_FILE = 4 * 1024 * 1024;
  function readRaw(req, max) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > max) { reject({ status: 413, message: 'El archivo supera los 4 MB.' }); req.resume(); return; }
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > max) { reject({ status: 413, message: 'El archivo supera los 4 MB.' }); req.destroy(); return; } chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => reject({ status: 400, message: 'No se pudo recibir el archivo.' }));
    });
  }
  function sniff(b) {
    if (b.length < 12) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ['png', 'image/png'];
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['jpg', 'image/jpeg'];
    if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return ['webp', 'image/webp'];
    if (b.toString('latin1', 0, 3) === 'GIF') return ['gif', 'image/gif'];
    return null;
  }
  function evUrl(v) {
    const s = clean(v, 400); if (!s) return null;
    try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch (_) { return null; }
  }
  // Líder, Colíder o Capitán de uno de los dos clanes del partido.
  function clanSideOf(me, m) {
    const mm = st.memberOf.get(me.id);
    return !!(mm && CAN_MATCH.includes(mm.role) && (mm.clan_id === m.winner_id || mm.clan_id === m.loser_id));
  }
  // Quién puede agregar o ver evidencias según a qué pertenezcan (partido, denuncia o sanción).
  function evOwner(type, id) {
    if (type === 'match') {
      const m = st.matchRow.get(id); if (!m || m.status === 'deleted') return null;
      return { row: m, info: { type: 'partido', id: m.id, match: m.id }, staff: (me) => can(me, 'evidence.add'),
        canAdd: (me) => can(me, 'evidence.add') || clanSideOf(me, m), canView: (me, e) => can(me, 'evidence.view') || (!e.hidden && clanSideOf(me, m)) };
    }
    if (type === 'complaint') {
      const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id); if (!c) return null;
      return { row: c, info: { type: 'denuncia', id: c.id, player: c.accused_id }, staff: (me) => can(me, 'complaints.manage'),
        canAdd: (me) => can(me, 'complaints.manage') || (c.accuser_id === me.id && ['received', 'pending'].includes(c.status)), canView: (me) => can(me, 'complaints.manage') };
    }
    if (type === 'sanction') {
      const sa = db.prepare('SELECT * FROM sanctions WHERE id = ?').get(id); if (!sa) return null;
      return { row: sa, info: { type: 'sanción', id: sa.id, player: sa.player_id, clan: sa.clan_id }, staff: (me) => can(me, 'sanctions.warn'),
        canAdd: (me) => can(me, 'sanctions.warn'), canView: (me) => can(me, 'sanctions.view') };
    }
    if (type === 'disc') {
      const d = db.prepare('SELECT * FROM disc_reports WHERE id = ?').get(id); if (!d) return null;
      return { row: d, info: { type: 'reporte disciplinario', id: d.id, clan: d.clan_id, player: d.leader_id }, staff: (me) => can(me, 'disc.manage'),
        canAdd: (me) => can(me, 'disc.manage'), canView: (me) => can(me, 'disc.view') };
    }
    return null;
  }
  const evView = (e, staff) => ({ id: e.id, kind: e.kind, label: e.label, url: e.kind === 'link' ? e.ref : '/api/evidence/file?id=' + e.id, mime: e.mime, size: e.size, by: e.by_alias, at: e.created_at, hidden: !!e.hidden, staff });
  const REPORT_FLAGS = ['duplicate', 'invalid', 'needs_info'];
  const hoursCfg = () => Math.max(1, Math.min(720, parseInt(config('unreported_hours', '72'), 10) || 72));

  /* ---------- Sanciones: tipos, bloqueos y expiración ---------- */
  const DAY = 86400000;
  const TYPE_LABEL = { warning: 'Advertencia', reprimand: 'Amonestación oficial', point_loss: 'Pérdida de puntos', result_annulment: 'Anulación de un resultado', ladder_suspension: 'Suspensión temporal de la Ladder', tournament_suspension: 'Suspensión de participación en torneos', temp_disqualification: 'Inhabilitación temporal para competir', expulsion: 'Expulsión de una competición', permanent_ban: 'Baneo permanente' };
  const BLOCK_TYPES = ['ladder_suspension', 'temp_disqualification', 'expulsion', 'permanent_ban'];
  const NEEDS_DURATION = ['ladder_suspension', 'temp_disqualification', 'tournament_suspension'];
  const LIGHT_TYPES = ['warning', 'reprimand'];
  const CHEAT_REASONS = ['cheats', 'programs', 'falsified', 'manipulation'];
  const SEVERITY = ['leve', 'moderada', 'grave'];
  const SEV_ES = { leve: 'Leve', moderada: 'Moderada', grave: 'Grave' };
  const activeCond = "status = 'active' AND starts_at <= ? AND (ends_at = 0 OR ends_at > ?)";
  const blockIn = "type IN ('" + BLOCK_TYPES.join("','") + "')";
  function shist(sid, actor, action, o, n, reason) {
    db.prepare('INSERT INTO sanction_history (sanction_id, at, actor, action, old_json, new_json, reason) VALUES (?,?,?,?,?,?,?)').run(sid, Date.now(), actor, action, o ? JSON.stringify(o) : '', n ? JSON.stringify(n) : '', reason || '');
  }
  // Mensaje si el jugador (o su clan) no puede competir; '' si puede.
  function competeBlock(pid, clanId) {
    const now = Date.now();
    const r = db.prepare('SELECT target_type, type FROM sanctions WHERE ' + activeCond + ' AND ' + blockIn + " AND ((target_type = 'player' AND player_id = ?) OR (target_type = 'clan' AND clan_id = ? AND ? > 0)) LIMIT 1").get(now, now, pid, clanId || 0, clanId || 0);
    if (!r) return '';
    return r.target_type === 'clan' ? 'Tu clan tiene una sanción vigente y no puede competir por ahora. Revisa los detalles en Manejo de cuenta.' : 'Tienes una sanción vigente que te impide competir. Revisa los detalles en Manejo de cuenta.';
  }
  function clanBlocked(clanId) {
    const now = Date.now();
    return !!db.prepare("SELECT 1 FROM sanctions WHERE target_type = 'clan' AND clan_id = ? AND " + activeCond + ' AND ' + blockIn + ' LIMIT 1').get(clanId, now, now);
  }
  // Las sanciones temporales vencidas pasan a «expirada» sin borrar nada.
  function expireSanctions() {
    try {
      const now = Date.now();
      const due = db.prepare("SELECT * FROM sanctions WHERE status = 'active' AND ends_at > 0 AND ends_at <= ?").all(now);
      for (const sa of due) {
        tx(() => {
          const r = db.prepare("UPDATE sanctions SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'active'").run(now, sa.id);
          if (Number(r.changes) !== 1) return;
          shist(sa.id, 'sistema', 'expirada', { estado: 'active' }, { estado: 'expired' }, 'Venció el plazo de la sanción');
          audit(null, 'sancion_expirada', { type: 'sanción', id: sa.id, player: sa.player_id, clan: sa.clan_id }, { estado: 'active' }, { estado: 'expired' }, 'Venció el plazo', 'ok');
        });
      }
    } catch (e) { console.error('[sanciones]', e.message); }
  }
  expireSanctions();
  setInterval(expireSanctions, 60 * 1000).unref();
  const appealDays = () => Math.max(1, Math.min(60, parseInt(config('appeal_days', '7'), 10) || 7));
  const sanctionLine = (sa) => ({ id: sa.id, targetType: sa.target_type, playerId: sa.player_id, clanId: sa.clan_id, type: sa.type, typeLabel: TYPE_LABEL[sa.type] || sa.type, reasonCode: sa.reason_code,
    severity: sa.severity, status: sa.status, startsAt: sa.starts_at, endsAt: sa.ends_at, appealable: !!sa.appealable, appealStatus: sa.appeal_status, createdAt: sa.created_at, by: sa.by_alias, matchId: sa.match_id, pts: sa.pts });
  const reasonLabel = (code) => { const r = db.prepare('SELECT label FROM sanction_reasons WHERE code = ?').get(code); return r ? r.label : code; };
  const COMPLAINT_STATUS = ['received', 'pending', 'investigating', 'insufficient', 'confirmed', 'rejected', 'closed'];
  const COMPLAINT_FINAL = ['confirmed', 'rejected', 'closed'];
  const DISC_STATUS = ['pending', 'notified', 'review', 'resolved', 'closed'];

  /* ---------- Rutas ---------- */
  async function handle(req, res, pathname) {
    const u = new URL(req.url, 'http://x');
    const get = (k) => u.searchParams.get(k) || '';
    const method = req.method;
    const me = currentPlayer(req);

    if (!me) return sendJson(res, 401, { error: 'Inicia sesión.' }), true;
    const role = roleOf(me);
    const deny = (perm) => {
      if (!isLimited(req, 'denied', 30)) { addHit(req, 'denied', 60 * 60 * 1000); audit(me, 'acceso_denegado', { type: 'ruta' }, null, { ruta: pathname, permiso: perm }, '', 'denegado', req); }
      sendJson(res, 403, { error: 'No tienes permiso para hacer esto.' });
      return false;
    };
    const need = (perm) => (can(me, perm) ? true : deny(perm));

    /* ----- Rutas para jugadores (evidencias y avisos de su clan) ----- */
    if (method === 'POST' && pathname === '/api/evidence/upload') {
      if (isLimited(req, 'evup', 30)) { sendJson(res, 429, { error: 'Demasiadas subidas. Prueba más tarde.' }); return true; }
      const otype = get('type'), own = evOwner(otype, int(get('id'), 1, 1e12) || 0);
      if (!own) { sendJson(res, 404, { error: 'No existe ese registro.' }); return true; }
      const m = own.row; const staffOk = own.staff(me);
      if (!own.canAdd(me)) return deny('evidence.add'), true;
      const n = st.evCount.get(otype, m.id).n;
      if (n >= (staffOk ? 40 : 10)) { sendJson(res, 409, { error: 'Ya tiene el máximo de evidencias.' }); return true; }
      addHit(req, 'evup', 60 * 60 * 1000);
      const buf = await readRaw(req, MAX_FILE);
      const kind = sniff(buf);
      if (!kind) { sendJson(res, 400, { error: 'Solo se permiten imágenes PNG, JPG, WEBP o GIF.' }); return true; }
      const file = crypto.randomBytes(16).toString('hex') + '.' + kind[0];
      fs.writeFileSync(path.join(EVDIR, file), buf, { mode: 0o600 });
      const label = clean(get('name'), 80).replace(/[^\w .()\-áéíóúñÁÉÍÓÚÑ]/g, '') || 'captura';
      let id;
      try {
        id = tx(() => {
          const r = st.evAdd.run(otype, m.id, 'file', file, label, kind[1], buf.length, me.id, me.alias, Date.now());
          audit(me, 'evidencia_agregada', own.info, null, { archivo: label, tipo: kind[1], bytes: buf.length }, '', 'ok', req);
          return Number(r.lastInsertRowid);
        });
      } catch (e) { try { fs.unlinkSync(path.join(EVDIR, file)); } catch (_) { /* ya no existe */ } console.error(e); sendJson(res, 500, { error: 'No se pudo guardar la evidencia.' }); return true; }
      sendJson(res, 201, { ok: true, id });
      return true;
    }
    if (method === 'GET' && pathname === '/api/evidence/file') {
      const e = st.evById.get(int(get('id'), 1, 1e12) || 0);
      const own = e ? evOwner(e.owner_type, e.owner_id) : null;
      const ok = !!(e && own && e.kind === 'file' && own.canView(me, e));
      if (!ok) { sendJson(res, 404, { error: 'No encontrado.' }); return true; }
      let data;
      try { data = fs.readFileSync(path.join(EVDIR, path.basename(e.ref))); } catch (_) { sendJson(res, 404, { error: 'El archivo ya no está disponible.' }); return true; }
      res.writeHead(200, { 'Content-Type': e.mime, 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      res.end(data);
      return true;
    }
    if (method === 'GET' && pathname === '/api/my/admin') {
      const mm = st.memberOf.get(me.id);
      const isLeaderish = !!(mm && ['leader', 'coleader'].includes(mm.role));
      let matches = [];
      if (mm && CAN_MATCH.includes(mm.role)) {
        const rows = db.prepare("SELECT * FROM matches WHERE (winner_id = ? OR loser_id = ?) AND status IN ('pending','disputed','confirmed') ORDER BY COALESCE(NULLIF(resolved_at,0), created_at) DESC, id DESC LIMIT 10").all(mm.clan_id, mm.clan_id);
        matches = rows.map((m) => ({
          id: m.id, status: m.status, flag: m.report_state, date: m.played_at || m.resolved_at || m.created_at,
          winner: (q.clanById.get(m.winner_id) || {}).name, loser: (q.clanById.get(m.loser_id) || {}).name,
          resolutions: st.notesOf.all(m.id).filter((n) => n.kind === 'resolution').map((n) => ({ at: n.created_at, text: n.body, by: n.by_alias })),
          evidence: st.evOf.all('match', m.id).filter((e) => !e.hidden).map((e) => evView(e, false)),
        }));
      }
      const sRows = db.prepare("SELECT * FROM sanctions WHERE (target_type = 'player' AND player_id = ?)" + (isLeaderish ? " OR (target_type = 'clan' AND clan_id = ?)" : '') + ' ORDER BY id DESC LIMIT 20').all(...(isLeaderish ? [me.id, mm.clan_id] : [me.id]));
      const now = Date.now();
      const sanctions = sRows.map((sa) => Object.assign(sanctionLine(sa), {
        reason: reasonLabel(sa.reason_code), description: sa.description, rules: sa.rules, appealResolution: sa.appeal_resolution,
        canAppeal: !!sa.appealable && sa.status === 'active' && !sa.appeal_status && now - sa.created_at <= appealDays() * DAY && (sa.target_type === 'player' || isLeaderish),
        appealUntil: sa.created_at + appealDays() * DAY,
      }));
      const complaints = db.prepare('SELECT c.id, c.status, c.created_at, p.alias AS accused FROM complaints c JOIN players p ON p.id = c.accused_id WHERE c.accuser_id = ? ORDER BY c.id DESC LIMIT 10').all(me.id)
        .map((c) => ({ id: c.id, status: c.status, at: c.created_at, accused: c.accused }));
      const discs = db.prepare("SELECT d.*, c.name AS cname FROM disc_reports d JOIN clans c ON c.id = d.clan_id WHERE d.leader_id = ? AND d.status <> 'pending' ORDER BY d.id DESC LIMIT 10").all(me.id)
        .map((d) => ({ id: d.id, clan: d.cname, reason: d.reason, description: d.description, incidentAt: d.incident_at, severity: d.severity, deadlineAt: d.deadline_at, status: d.status, response: d.leader_response, respondedAt: d.responded_at, resolution: d.status === 'resolved' || d.status === 'closed' ? d.resolution : '', measures: d.status === 'resolved' || d.status === 'closed' ? d.measures : '', matchId: d.match_id, late: d.deadline_at > 0 && now > d.deadline_at }));
      sendJson(res, 200, { matches, sanctions, complaints, discs });
      return true;
    }

    /* ----- Jugadores: apelar, responder a un reporte disciplinario y denunciar ----- */
    if (method === 'POST' && pathname === '/api/appeal') {
      const b = await readJson(req);
      const sa = db.prepare('SELECT * FROM sanctions WHERE id = ?').get(parseInt(b.sanctionId, 10) || 0);
      const mm = st.memberOf.get(me.id);
      const mine = sa && ((sa.target_type === 'player' && sa.player_id === me.id) || (sa.target_type === 'clan' && mm && mm.clan_id === sa.clan_id && ['leader', 'coleader'].includes(mm.role)));
      if (!mine) { sendJson(res, 404, { error: 'No encontramos esa sanción.' }); return true; }
      const text = clean(b.text, 1000);
      if (!sa.appealable) { sendJson(res, 409, { error: 'Esta sanción no admite apelación.' }); return true; }
      if (sa.status !== 'active') { sendJson(res, 409, { error: 'Esta sanción ya no está vigente.' }); return true; }
      if (sa.appeal_status) { sendJson(res, 409, { error: 'Ya presentaste una apelación para esta sanción.' }); return true; }
      if (Date.now() - sa.created_at > appealDays() * DAY) { sendJson(res, 409, { error: 'Venció el plazo para apelar (' + appealDays() + ' días).' }); return true; }
      if (text.length < 20) { sendJson(res, 400, { error: 'Explica tu apelación con al menos 20 caracteres.' }); return true; }
      tx(() => {
        const r = db.prepare("UPDATE sanctions SET appeal_text = ?, appeal_at = ?, appeal_status = 'pending', updated_at = ? WHERE id = ? AND appeal_status = ''").run(text, Date.now(), Date.now(), sa.id);
        if (Number(r.changes) !== 1) throw new Error('duplicada');
        shist(sa.id, me.alias, 'apelacion_presentada', null, { texto: text.slice(0, 300) }, '');
        audit(me, 'apelacion_presentada', { type: 'sanción', id: sa.id, player: sa.player_id, clan: sa.clan_id }, null, { texto: text.slice(0, 200) }, '', 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && pathname === '/api/disc/respond') {
      const b = await readJson(req);
      const d = db.prepare('SELECT * FROM disc_reports WHERE id = ? AND leader_id = ?').get(parseInt(b.id, 10) || 0, me.id);
      if (!d || d.status === 'pending') { sendJson(res, 404, { error: 'No encontramos ese reporte.' }); return true; }
      if (!['notified', 'review'].includes(d.status)) { sendJson(res, 409, { error: 'Este reporte ya fue resuelto.' }); return true; }
      const text = clean(b.text, 1500);
      if (text.length < 10) { sendJson(res, 400, { error: 'Escribe tu respuesta (al menos 10 caracteres).' }); return true; }
      tx(() => {
        db.prepare("UPDATE disc_reports SET leader_response = ?, responded_at = ?, status = 'review', updated_at = ? WHERE id = ?").run(text, Date.now(), Date.now(), d.id);
        audit(me, 'reporte_disciplinario_respondido', { type: 'reporte disciplinario', id: d.id, clan: d.clan_id, player: me.id }, { estado: d.status }, { estado: 'review', fueraDePlazo: d.deadline_at > 0 && Date.now() > d.deadline_at }, '', 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && pathname === '/api/complaint/create') {
      const b = await readJson(req);
      if (isLimited(req, 'complaint', 10)) { sendJson(res, 429, { error: 'Demasiadas denuncias. Prueba más tarde.' }); return true; }
      const accused = (parseInt(b.accusedId, 10) > 0 ? playerById(parseInt(b.accusedId, 10)) : null) || (clean(b.accusedAlias, 40) ? st.playerByAlias.get(clean(b.accusedAlias, 40)) : null);
      if (!accused) { sendJson(res, 404, { error: 'No existe un jugador con ese nombre o ID.' }); return true; }
      if (accused.id === me.id) { sendJson(res, 400, { error: 'No puedes denunciarte a ti mismo.' }); return true; }
      const description = clean(b.description, 2000);
      if (description.length < 20) { sendJson(res, 400, { error: 'Describe lo ocurrido con al menos 20 caracteres.' }); return true; }
      const key = clean(b.key, 60);
      if (key.length < 8) { sendJson(res, 400, { error: 'Solicitud incompleta. Recarga la página.' }); return true; }
      if (db.prepare('SELECT COUNT(*) AS n FROM complaints WHERE accuser_id = ? AND created_at > ?').get(me.id, Date.now() - DAY).n >= 5) { sendJson(res, 429, { error: 'Ya enviaste 5 denuncias hoy. Intenta mañana.' }); return true; }
      const mid = b.matchId ? int(b.matchId, 1, 1e12) : 0;
      if (b.matchId && (!mid || !st.matchRow.get(mid))) { sendJson(res, 404, { error: 'No existe ese partido.' }); return true; }
      const when = b.incidentAt ? int(b.incidentAt, 1, Date.now() + 3600000) : 0;
      if (b.incidentAt && !when) { sendJson(res, 400, { error: 'La fecha del incidente no es válida.' }); return true; }
      const sip = srvIp(b.serverIp);
      if (sip === null) { sendJson(res, 400, { error: 'La IP del servidor no es válida (ej. 200.1.2.3:12203).' }); return true; }
      const links = (Array.isArray(b.links) ? b.links : []).slice(0, 3).map(evUrl);
      if (links.some((l) => !l)) { sendJson(res, 400, { error: 'Los enlaces deben empezar con http:// o https://.' }); return true; }
      addHit(req, 'complaint', 60 * 60 * 1000);
      let id;
      try {
        id = tx(() => {
          if (Number(st.idem.run('cmp:' + key, Date.now()).changes) !== 1) throw { dup: true };
          const now = Date.now();
          const r = db.prepare("INSERT INTO complaints (accuser_id, accused_id, match_id, incident_at, server_ip, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'received',?,?)").run(me.id, accused.id, mid, when, sip, description, now, now);
          const cid = Number(r.lastInsertRowid);
          for (const l of links) st.evAdd.run('complaint', cid, 'link', l, 'enlace del denunciante', '', 0, me.id, me.alias, now);
          audit(me, 'denuncia_recibida', { type: 'denuncia', id: cid, player: accused.id, match: mid }, null, { denunciado: accused.alias, enlaces: links.length }, '', 'ok', req);
          return cid;
        });
      } catch (e) {
        if (e && e.dup) { sendJson(res, 409, { error: 'Esta denuncia ya se envió.' }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo enviar la denuncia.' }); return true;
      }
      sendJson(res, 201, { ok: true, id });
      return true;
    }

    if (!role) { deny('panel.view'); return true; }

    if (method === 'GET' && pathname === '/api/admin/me') {
      sendJson(res, 200, { alias: me.alias, role, roleLabel: ROLE_LABEL[role], perms: permsOf(me) });
      return true;
    }

    /* ----- Dashboard ----- */
    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      if (!need('panel.view')) return true;
      const n = (sql) => db.prepare(sql).get().n;
      const recent = db.prepare('SELECT id, at, actor_alias, action, target_type, target_id, reason, result FROM audit_log ORDER BY id DESC LIMIT 10').all()
        .map((r) => ({ id: r.id, at: r.at, actor: r.actor_alias, action: r.action, type: r.target_type, targetId: r.target_id, reason: r.reason, result: r.result }));
      sendJson(res, 200, {
        players: n('SELECT COUNT(*) AS n FROM players'), clans: n('SELECT COUNT(*) AS n FROM clans'),
        played: n("SELECT COUNT(*) AS n FROM matches WHERE status = 'confirmed'"),
        toValidate: n("SELECT COUNT(*) AS n FROM matches WHERE status = 'pending'"),
        disputed: n("SELECT COUNT(*) AS n FROM matches WHERE status = 'disputed'"),
        sanctioned: n("SELECT COUNT(DISTINCT player_id) AS n FROM sanctions WHERE target_type = 'player' AND status = 'active' AND (ends_at = 0 OR ends_at > " + Date.now() + ')'),
        suspended: n("SELECT COUNT(DISTINCT player_id) AS n FROM sanctions WHERE target_type = 'player' AND status = 'active' AND type IN ('ladder_suspension','temp_disqualification','expulsion') AND (ends_at = 0 OR ends_at > " + Date.now() + ')'),
        banned: n("SELECT COUNT(DISTINCT player_id) AS n FROM sanctions WHERE target_type = 'player' AND status = 'active' AND type = 'permanent_ban'"),
        clansWithDisc: n("SELECT COUNT(DISTINCT clan_id) AS n FROM disc_reports WHERE status IN ('pending','notified','review')"),
        complaintsOpen: n("SELECT COUNT(*) AS n FROM complaints WHERE status IN ('received','pending','investigating')"),
        appealsOpen: n("SELECT COUNT(*) AS n FROM sanctions WHERE appeal_status = 'pending'"),
        clansWithPending: n("SELECT COUNT(DISTINCT c) AS n FROM (SELECT winner_id AS c FROM matches WHERE status IN ('pending','disputed') UNION SELECT loser_id FROM matches WHERE status IN ('pending','disputed'))"),
        recent,
      });
      return true;
    }

    if (method === 'GET' && pathname === '/api/admin/clanlist') {
      if (!need('matches.view')) return true;
      sendJson(res, 200, { clans: db.prepare('SELECT id, name FROM clans ORDER BY name COLLATE NOCASE').all() });
      return true;
    }

    /* ----- Partidos: listado con filtros ----- */
    if (method === 'GET' && pathname === '/api/admin/matches') {
      if (!need('matches.view')) return true;
      const D = 'COALESCE(NULLIF(m.played_at,0), NULLIF(m.resolved_at,0), m.created_at)';
      const where = [], args = [];
      const esc = (t) => t.replace(/[\\%_]/g, (c) => '\\' + c);
      const status = get('status');
      if (MATCH_STATUS.includes(status)) { where.push('m.status = ?'); args.push(status); } else where.push("m.status <> 'deleted'");
      const term = clean(get('q'), 40);
      if (term) {
        const like = '%' + esc(term) + '%';
        where.push("(w.name LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM match_players mp JOIN players p ON p.id = mp.player_id WHERE mp.match_id = m.id AND p.alias LIKE ? ESCAPE '\\')" + (/^\d+$/.test(term) ? ' OR m.id = ?' : '') + ')');
        args.push(like, like, like); if (/^\d+$/.test(term)) args.push(Number(term));
      }
      const clan = int(get('clan'), 1, 1e12); if (clan) { where.push('(m.winner_id = ? OR m.loser_id = ?)'); args.push(clan, clan); }
      const pl = int(get('player'), 1, 1e12); if (pl) { where.push('EXISTS (SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.player_id = ?)'); args.push(pl); }
      const mode = clean(get('mode'), 30); if (mode) { where.push('m.mode = ?'); args.push(mode); }
      const from = int(get('from'), 1, 4e12), to = int(get('to'), 1, 4e12);
      if (from) { where.push(D + ' >= ?'); args.push(from); }
      if (to) { where.push(D + ' <= ?'); args.push(to); }
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const base = ' FROM matches m JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id WHERE ' + where.join(' AND ');
      const total = db.prepare('SELECT COUNT(*) AS n' + base).get(...args).n;
      const rows = db.prepare('SELECT m.*, w.name AS wname, l.name AS lname, ' + D + ' AS d' + base + ' ORDER BY d DESC, m.id DESC LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, matches: rows.map((m) => ({ id: m.id, status: m.status, date: m.d, winner: m.wname, winnerId: m.winner_id, loser: m.lname, loserId: m.loser_id, scoreW: m.score_w, scoreL: m.score_l, mode: m.mode, reportState: m.report_state })) });
      return true;
    }

    /* ----- Partido: ficha ----- */
    if (method === 'GET' && pathname === '/api/admin/match') {
      if (!need('matches.view')) return true;
      const m = st.matchRow.get(parseInt(get('id'), 10) || 0);
      if (!m) { sendJson(res, 404, { error: 'Ese partido no existe.' }); return true; }
      const rep = m.reporter_id ? q.playerIdOnly.get(m.reporter_id) : null, conf = m.confirmer_id ? q.playerIdOnly.get(m.confirmer_id) : null;
      const history = db.prepare('SELECT id, at, actor_alias, action, old_json, new_json, reason, result FROM audit_log WHERE match_id = ? ORDER BY id DESC LIMIT 50').all(m.id)
        .map((r) => ({ id: r.id, at: r.at, actor: r.actor_alias, action: r.action, old: r.old_json, new: r.new_json, reason: r.reason, result: r.result }));
      sendJson(res, 200, {
        match: Object.assign(matchView(m), { reporter: rep ? rep.alias : '', confirmer: conf ? conf.alias : '', reportComment: m.report_comment, confirmComment: m.confirm_comment }),
        winnerPlayers: roster(m.id, 'winner'), loserPlayers: roster(m.id, 'loser'), history,
        canEdit: can(me, 'matches.edit'), canDelete: can(me, 'matches.delete'), canHardDelete: role === 'superadmin',
        canReview: can(me, 'reports.review'), canEvidence: can(me, 'evidence.add'),
        notes: st.notesOf.all(m.id).filter((n) => n.kind === 'resolution' || can(me, 'reports.review')).map((n) => ({ id: n.id, kind: n.kind, text: n.body, by: n.by_alias, at: n.created_at })),
        evidence: can(me, 'evidence.view') ? st.evOf.all('match', m.id).map((e) => evView(e, true)) : [],
      });
      return true;
    }

    /* ----- Partido: crear manualmente ----- */
    if (method === 'POST' && pathname === '/api/admin/match/create') {
      if (!need('matches.edit')) return true;
      const b = await readJson(req);
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const sea = q.activeSeason.get();
      if (!sea) { sendJson(res, 409, { error: 'No hay una temporada activa.' }); return true; }
      const key = clean(b.key, 60);
      if (key.length < 8) { sendJson(res, 400, { error: 'Solicitud incompleta. Recarga la página.' }); return true; }
      const wid = int(b.winnerId, 1, 1e12), lid = int(b.loserId, 1, 1e12);
      if (!wid || !lid || wid === lid || !q.clanById.get(wid) || !q.clanById.get(lid)) { sendJson(res, 400, { error: 'Elige dos clanes distintos que existan.' }); return true; }
      const status = SETTABLE.includes(b.status) ? b.status : '';
      if (!['pending', 'disputed', 'confirmed'].includes(status)) { sendJson(res, 400, { error: 'El estado inicial debe ser pendiente, en disputa o validado.' }); return true; }
      const wp = playersList(b.winnerPlayers), lp = playersList(b.loserPlayers);
      if (!wp || !lp) { sendJson(res, 400, { error: 'Revisa las IDs de jugadores (deben existir).' }); return true; }
      if (!lp.length || (status === 'confirmed' && !wp.length)) { sendJson(res, 400, { error: 'Indica los jugadores que participaron en cada lado.' }); return true; }
      if (status === 'pending' && q.pendingPair.get(wid, lid, lid, wid)) { sendJson(res, 409, { error: 'Ya hay un reporte pendiente entre estos clanes.' }); return true; }
      const sw = b.scoreW === '' || b.scoreW == null ? -1 : int(b.scoreW, 0, 999), sl = b.scoreL === '' || b.scoreL == null ? -1 : int(b.scoreL, 0, 999);
      if (sw === null || sl === null || (sw < 0) !== (sl < 0)) { sendJson(res, 400, { error: 'Marcador no válido: indica los dos valores (0 a 999) o ninguno.' }); return true; }
      const when = b.playedAt ? int(b.playedAt, 1, Date.now() + 86400000) : 0;
      if (b.playedAt && !when) { sendJson(res, 400, { error: 'Fecha no válida.' }); return true; }
      const mode = clean(b.mode, 30);
      let id;
      try {
        id = tx(() => {
          if (Number(st.idem.run(key, Date.now()).changes) !== 1) throw { dup: true };
          const now = Date.now();
          const r = db.prepare("INSERT INTO matches (winner_id, loser_id, reporter_id, status, created_at, resolved_at, season_id, played_at, score_w, score_l, mode, report_comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(wid, lid, me.id, status, now, status === 'confirmed' ? now : 0, sea.id, when, sw, sl, mode, 'Registrado por la administración');
          const mid = Number(r.lastInsertRowid);
          for (const p of wp) st.addSide.run(mid, p, 'winner');
          for (const p of lp) st.addSide.run(mid, p, 'loser');
          recompute();
          audit(me, 'partido_creado', { type: 'partido', id: mid, match: mid, clan: wid }, null, snapshot(st.matchRow.get(mid)), reason, 'ok', req);
          return mid;
        });
      } catch (e) {
        if (e && e.dup) { sendJson(res, 409, { error: 'Esta operación ya se registró.' }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo crear el partido.' }); return true;
      }
      sendJson(res, 201, { ok: true, id });
      return true;
    }

    /* ----- Partido: modificar (resultado, marcador, fecha, jugadores, estado) ----- */
    if (method === 'POST' && pathname === '/api/admin/match/update') {
      if (!need('matches.edit')) return true;
      const b = await readJson(req);
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const m = st.matchRow.get(parseInt(b.id, 10) || 0);
      if (!m) { sendJson(res, 404, { error: 'Ese partido no existe.' }); return true; }
      if (m.status === 'deleted') { sendJson(res, 409, { error: 'Restaura el partido antes de modificarlo.' }); return true; }
      if (int(b.rev, 0, 1e9) !== m.rev) { sendJson(res, 409, { error: 'Otro administrador modificó este partido. Recarga la ficha.' }); return true; }
      const sea = q.seasonById.get(m.season_id);
      const frozen = !sea || sea.status !== 'active';
      const old = snapshot(m);

      let winner = m.winner_id, loser = m.loser_id, status = m.status;
      let swap = false;
      if (b.winnerId !== undefined && int(b.winnerId, 1, 1e12) !== winner) {
        const w = int(b.winnerId, 1, 1e12);
        if (w !== m.winner_id && w !== m.loser_id) { sendJson(res, 400, { error: 'El ganador debe ser uno de los dos clanes del partido.' }); return true; }
        swap = true; winner = m.loser_id; loser = m.winner_id;
      }
      if (b.status !== undefined && b.status !== m.status) {
        if (!SETTABLE.includes(b.status)) { sendJson(res, 400, { error: 'Estado no válido.' }); return true; }
        status = b.status;
      }
      if (frozen && (swap || status !== m.status)) { sendJson(res, 409, { error: 'Este partido pertenece a una temporada cerrada: no se puede cambiar el ganador ni el estado.' }); return true; }

      let sw = m.score_w, sl = m.score_l;
      if (b.scoreW !== undefined || b.scoreL !== undefined) {
        sw = b.scoreW === '' || b.scoreW == null ? -1 : int(b.scoreW, 0, 999);
        sl = b.scoreL === '' || b.scoreL == null ? -1 : int(b.scoreL, 0, 999);
        if (sw === null || sl === null || (sw < 0) !== (sl < 0)) { sendJson(res, 400, { error: 'Marcador no válido: indica los dos valores (0 a 999) o ninguno.' }); return true; }
      } else if (swap) { sw = m.score_l; sl = m.score_w; }
      let when = m.played_at;
      if (b.playedAt !== undefined) {
        when = b.playedAt ? int(b.playedAt, 1, Date.now() + 86400000) : 0;
        if (b.playedAt && !when) { sendJson(res, 400, { error: 'Fecha no válida.' }); return true; }
      }
      const mode = b.mode !== undefined ? clean(b.mode, 30) : m.mode;
      let wp = null, lp = null;
      if (b.winnerPlayers !== undefined) { wp = playersList(b.winnerPlayers); if (!wp) { sendJson(res, 400, { error: 'Revisa las IDs de los jugadores ganadores.' }); return true; } }
      if (b.loserPlayers !== undefined) { lp = playersList(b.loserPlayers); if (!lp) { sendJson(res, 400, { error: 'Revisa las IDs de los jugadores perdedores.' }); return true; } }

      try {
        tx(() => {
          const nowT = Date.now();
          let resolved = m.resolved_at;
          if (status === 'confirmed' && m.status !== 'confirmed') resolved = nowT;
          if (status === 'confirmed' && when) resolved = when;
          const r = db.prepare('UPDATE matches SET winner_id = ?, loser_id = ?, status = ?, score_w = ?, score_l = ?, played_at = ?, mode = ?, resolved_at = ?, prev_status = CASE WHEN ? <> status THEN status ELSE prev_status END, rev = rev + 1 WHERE id = ? AND rev = ?')
            .run(winner, loser, status, sw, sl, when, mode, resolved, status, m.id, m.rev);
          if (Number(r.changes) !== 1) throw { conflict: true };
          if (swap) st.flipSides.run(m.id);
          if (wp) { st.delSide.run(m.id, 'winner'); for (const p of wp) st.addSide.run(m.id, p, 'winner'); }
          if (lp) { st.delSide.run(m.id, 'loser'); for (const p of lp) st.addSide.run(m.id, p, 'loser'); }
          const after = st.matchRow.get(m.id);
          const nl = st.sidePlayers.all(m.id, 'loser').length, nw = st.sidePlayers.all(m.id, 'winner').length;
          if (['pending', 'disputed', 'confirmed'].includes(after.status) && !nl) throw { msg: 'Debe quedar al menos un jugador perdedor.' };
          if (after.status === 'confirmed' && !nw) throw { msg: 'Para validar el partido marca al menos un jugador ganador.' };
          if (!frozen) recompute();
          const nw2 = snapshot(after);
          const diff = (k) => JSON.stringify(old[k]) !== JSON.stringify(nw2[k]);
          const keys = Object.keys(old).filter(diff);
          if (!keys.length) throw { msg: 'No hay cambios que guardar.' };
          const o = {}, n = {}; keys.forEach((k) => { o[k] = old[k]; n[k] = nw2[k]; });
          const action = status !== m.status ? 'partido_estado_' + status : 'partido_modificado';
          audit(me, action, { type: 'partido', id: m.id, match: m.id, clan: winner }, o, n, reason, 'ok', req);
        });
      } catch (e) {
        if (e && e.conflict) { sendJson(res, 409, { error: 'Otro administrador modificó este partido. Recarga la ficha.' }); return true; }
        if (e && e.msg) { sendJson(res, 400, { error: e.msg }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo guardar el cambio.' }); return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Partido: eliminar (lógico o definitivo) y restaurar ----- */
    if (method === 'POST' && pathname === '/api/admin/match/action') {
      const b = await readJson(req);
      const act = b.action;
      if (!['delete', 'restore', 'hard_delete'].includes(act)) { sendJson(res, 400, { error: 'Acción no válida.' }); return true; }
      if (!need(act === 'hard_delete' ? 'matches.hard_delete' : 'matches.delete')) return true;
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const m = st.matchRow.get(parseInt(b.id, 10) || 0);
      if (!m) { sendJson(res, 404, { error: 'Ese partido no existe.' }); return true; }
      if (int(b.rev, 0, 1e9) !== m.rev) { sendJson(res, 409, { error: 'Otro administrador modificó este partido. Recarga la ficha.' }); return true; }
      const sea = q.seasonById.get(m.season_id);
      const frozen = !sea || sea.status !== 'active';
      if (act === 'hard_delete' && b.confirmText !== 'ELIMINAR') { sendJson(res, 400, { error: 'Para eliminar definitivamente escribe ELIMINAR.' }); return true; }
      if (act === 'delete' && m.status === 'deleted') { sendJson(res, 409, { error: 'El partido ya está eliminado.' }); return true; }
      if (act === 'restore' && m.status !== 'deleted') { sendJson(res, 409, { error: 'El partido no está eliminado.' }); return true; }
      if (frozen && act !== 'hard_delete' && m.status !== 'deleted') { /* en temporada cerrada la tabla final ya está guardada; solo se oculta */ }
      const old = snapshot(m);
      try {
        tx(() => {
          let r;
          if (act === 'delete') r = db.prepare("UPDATE matches SET prev_status = status, status = 'deleted', rev = rev + 1 WHERE id = ? AND rev = ?").run(m.id, m.rev);
          else if (act === 'restore') r = db.prepare("UPDATE matches SET status = CASE WHEN prev_status IN ('pending','disputed','confirmed','rejected','annulled','cancelled') THEN prev_status ELSE 'annulled' END, rev = rev + 1 WHERE id = ? AND rev = ?").run(m.id, m.rev);
          else {
            r = db.prepare('DELETE FROM matches WHERE id = ? AND rev = ?').run(m.id, m.rev);
            if (Number(r.changes) === 1) {
              for (const e of st.evOf.all('match', m.id)) if (e.kind === 'file') { try { fs.unlinkSync(path.join(EVDIR, path.basename(e.ref))); } catch (_) { /* ya no existe */ } }
              db.prepare("DELETE FROM evidence WHERE owner_type = 'match' AND owner_id = ?").run(m.id);
              db.prepare('DELETE FROM match_notes WHERE match_id = ?').run(m.id);
            }
          }
          if (Number(r.changes) !== 1) throw { conflict: true };
          if (!frozen) recompute();
          const nw = act === 'hard_delete' ? { eliminado: 'definitivamente' } : snapshot(st.matchRow.get(m.id));
          audit(me, act === 'delete' ? 'partido_eliminado_logico' : act === 'restore' ? 'partido_restaurado' : 'partido_eliminado_definitivo',
            { type: 'partido', id: m.id, match: m.id, clan: m.winner_id }, old, nw, reason, 'ok', req);
        });
      } catch (e) {
        if (e && e.conflict) { sendJson(res, 409, { error: 'Otro administrador modificó este partido. Recarga la ficha.' }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo completar la acción.' }); return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }


    /* ----- Reportes: cola de revisión ----- */
    if (method === 'GET' && pathname === '/api/admin/reports') {
      if (!need('matches.view')) return true;
      const view = get('view');
      const where = view === 'flagged' ? "m.report_state <> '' AND m.status <> 'deleted'" : view === 'deleted' ? "m.status = 'deleted'" : view === 'all' ? "m.status <> 'deleted'" : "m.status IN ('pending','disputed')";
      const args = [];
      let cond = where;
      const term = clean(get('q'), 40);
      if (term) { const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%'; cond += " AND (w.name LIKE ? ESCAPE '\\' OR l.name LIKE ? ESCAPE '\\' OR rp.alias LIKE ? ESCAPE '\\')"; args.push(like, like, like); }
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const base = ' FROM matches m JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id LEFT JOIN players rp ON rp.id = m.reporter_id WHERE ' + cond;
      const total = db.prepare('SELECT COUNT(*) AS n' + base).get(...args).n;
      const order = !view || view === 'queue' ? 'm.created_at ASC' : 'm.created_at DESC';
      const rows = db.prepare('SELECT m.*, w.name AS wname, l.name AS lname, rp.alias AS rname, (SELECT COUNT(*) FROM evidence e WHERE e.owner_type = \'match\' AND e.owner_id = m.id) AS nev' + base + ' ORDER BY ' + order + ', m.id LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, hours: hoursCfg(), reports: rows.map((m) => ({ id: m.id, status: m.status, flag: m.report_state, createdAt: m.created_at, reporter: m.rname || '', winner: m.wname, loser: m.lname, evidence: m.nev })) });
      return true;
    }

    /* ----- Alertas: reportes que el clan ganador no respondió dentro del plazo ----- */
    if (method === 'GET' && pathname === '/api/admin/alerts') {
      if (!need('matches.view')) return true;
      const h = hoursCfg();
      const rows = db.prepare("SELECT m.id, m.created_at, m.winner_id, m.loser_id FROM matches m WHERE m.status = 'pending' AND m.created_at <= ? ORDER BY m.created_at LIMIT 50").all(Date.now() - h * 3600000);
      sendJson(res, 200, { hours: h, alerts: rows.map((m) => ({
        id: m.id, createdAt: m.created_at, waitingHours: Math.floor((Date.now() - m.created_at) / 3600000),
        winner: (q.clanById.get(m.winner_id) || {}).name, loser: (q.clanById.get(m.loser_id) || {}).name,
        responsibles: db.prepare("SELECT p.alias FROM clan_members cm JOIN players p ON p.id = cm.player_id WHERE cm.clan_id = ? AND cm.role IN ('leader','coleader','captain') ORDER BY cm.role").all(m.winner_id).map((x) => x.alias),
      })) });
      return true;
    }

    /* ----- Reportes: marcar (duplicado, inválido, falta información) o quitar la marca ----- */
    if (method === 'POST' && (pathname === '/api/admin/report/flag' || pathname === '/api/admin/report/dispute')) {
      const b = await readJson(req);
      const dispute = pathname.endsWith('/dispute');
      const flag = dispute ? 'dispute' : b.flag;
      if (!dispute && ![...REPORT_FLAGS, 'clear'].includes(flag)) { sendJson(res, 400, { error: 'Acción no válida.' }); return true; }
      const m = st.matchRow.get(parseInt(b.id, 10) || 0);
      if (!m) { sendJson(res, 404, { error: 'Ese reporte no existe.' }); return true; }
      if (!need('reports.review')) return true;
      const annuls = flag === 'duplicate' || flag === 'invalid';
      if ((annuls || (dispute && m.status === 'confirmed')) && !need('matches.edit')) return true;
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      if (int(b.rev, 0, 1e9) !== m.rev) { sendJson(res, 409, { error: 'Otro administrador modificó este reporte. Recarga la ficha.' }); return true; }
      if (m.status === 'deleted') { sendJson(res, 409, { error: 'Restaura el partido antes de modificarlo.' }); return true; }
      const sea = q.seasonById.get(m.season_id), frozen = !sea || sea.status !== 'active';
      if ((annuls || dispute) && frozen) { sendJson(res, 409, { error: 'Este partido es de una temporada cerrada.' }); return true; }
      if (dispute && !['pending', 'confirmed', 'rejected'].includes(m.status)) { sendJson(res, 409, { error: 'Solo se puede abrir una disputa sobre un reporte pendiente, validado o rechazado.' }); return true; }
      const old = { estado: m.status, marca: m.report_state };
      try {
        tx(() => {
          let newStatus = m.status, newFlag = m.report_state;
          if (annuls) { newStatus = 'annulled'; newFlag = flag; }
          else if (flag === 'needs_info') newFlag = 'needs_info';
          else if (flag === 'clear') newFlag = '';
          else if (dispute) newStatus = 'disputed';
          const r = db.prepare('UPDATE matches SET status = ?, report_state = ?, prev_status = CASE WHEN ? <> status THEN status ELSE prev_status END, rev = rev + 1 WHERE id = ? AND rev = ?').run(newStatus, newFlag, newStatus, m.id, m.rev);
          if (Number(r.changes) !== 1) throw { conflict: true };
          if (flag === 'needs_info') st.noteAdd.run(m.id, 'resolution', 'La administración solicita más información sobre este reporte: ' + reason, me.alias, Date.now());
          if (dispute) st.noteAdd.run(m.id, 'resolution', 'La administración abrió una disputa sobre este resultado: ' + reason, me.alias, Date.now());
          if (newStatus !== m.status) recompute();
          audit(me, dispute ? 'disputa_abierta' : 'reporte_marcado_' + flag, { type: 'partido', id: m.id, match: m.id, clan: m.winner_id }, old, { estado: newStatus, marca: newFlag }, reason, 'ok', req);
        });
      } catch (e) {
        if (e && e.conflict) { sendJson(res, 409, { error: 'Otro administrador modificó este reporte. Recarga la ficha.' }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo guardar el cambio.' }); return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Notas privadas y resoluciones visibles para los clanes ----- */
    if (method === 'POST' && pathname === '/api/admin/match/note') {
      if (!need('reports.review')) return true;
      const b = await readJson(req);
      const m = st.matchRow.get(parseInt(b.id, 10) || 0);
      if (!m) { sendJson(res, 404, { error: 'Ese partido no existe.' }); return true; }
      const kind = b.kind === 'resolution' ? 'resolution' : b.kind === 'private' ? 'private' : '';
      const text = clean(b.text, 1000);
      if (!kind) { sendJson(res, 400, { error: 'Tipo de nota no válido.' }); return true; }
      if (text.length < 3) { sendJson(res, 400, { error: 'Escribe la nota (al menos 3 caracteres).' }); return true; }
      if (st.noteCount.get(m.id).n >= 100) { sendJson(res, 409, { error: 'Este partido ya tiene demasiadas notas.' }); return true; }
      const key = clean(b.key, 60);
      if (key.length < 8) { sendJson(res, 400, { error: 'Solicitud incompleta. Recarga la página.' }); return true; }
      try {
        tx(() => {
          if (Number(st.idem.run('note:' + key, Date.now()).changes) !== 1) throw { dup: true };
          st.noteAdd.run(m.id, kind, text, me.alias, Date.now());
          audit(me, kind === 'resolution' ? 'resolucion_publicada' : 'nota_privada', { type: 'partido', id: m.id, match: m.id }, null, { texto: text.slice(0, 200) }, '', 'ok', req);
        });
      } catch (e) {
        if (e && e.dup) { sendJson(res, 409, { error: 'Esa nota ya se guardó.' }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo guardar la nota.' }); return true;
      }
      sendJson(res, 201, { ok: true });
      return true;
    }

    /* ----- Evidencias: agregar enlace, ocultar o restaurar ----- */
    if (method === 'POST' && pathname === '/api/admin/evidence/link') {
      if (!need('evidence.add')) return true;
      const b = await readJson(req);
      const otype = ['match', 'complaint', 'sanction', 'disc'].includes(b.ownerType) ? b.ownerType : 'match';
      const own = evOwner(otype, parseInt(b.id, 10) || 0);
      const url = evUrl(b.url);
      if (!own) { sendJson(res, 404, { error: 'No existe ese registro.' }); return true; }
      if (!own.canAdd(me) || !own.staff(me)) return deny('evidence.add'), true;
      if (!url) { sendJson(res, 400, { error: 'El enlace debe empezar con http:// o https://.' }); return true; }
      if (st.evCount.get(otype, own.row.id).n >= 40) { sendJson(res, 409, { error: 'Ya tiene el máximo de evidencias.' }); return true; }
      tx(() => {
        st.evAdd.run(otype, own.row.id, 'link', url, clean(b.label, 80) || 'enlace', '', 0, me.id, me.alias, Date.now());
        audit(me, 'evidencia_agregada', own.info, null, { enlace: url }, '', 'ok', req);
      });
      sendJson(res, 201, { ok: true });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/evidence/hide') {
      if (!need('reports.review')) return true;
      const b = await readJson(req);
      const e = st.evById.get(parseInt(b.id, 10) || 0);
      if (!e) { sendJson(res, 404, { error: 'Esa evidencia no existe.' }); return true; }
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const hide = b.hide === true ? 1 : 0;
      if (e.hidden === hide) { sendJson(res, 409, { error: hide ? 'Ya está oculta.' : 'Ya está visible.' }); return true; }
      tx(() => {
        db.prepare('UPDATE evidence SET hidden = ? WHERE id = ?').run(hide, e.id);
        audit(me, hide ? 'evidencia_ocultada' : 'evidencia_restaurada', { type: 'partido', id: e.owner_id, match: e.owner_type === 'match' ? e.owner_id : 0 }, { oculta: !!e.hidden }, { oculta: !!hide }, reason, 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Noticias (administración y encargados de noticias) ----- */
    const NEWS_CATS = ['noticia', 'torneo', 'juego', 'importante'];
    if (method === 'GET' && pathname === '/api/admin/news') {
      if (!need('news.manage')) return true;
      const rows = db.prepare('SELECT * FROM news ORDER BY created_at DESC, id DESC LIMIT 200').all();
      sendJson(res, 200, { news: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, category: r.category, eventAt: r.event_at, published: !!r.published, pinned: !!r.pinned, author: r.author, at: r.created_at, updated: r.updated_at })) });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/news/save') {
      if (!need('news.manage')) return true;
      if (isLimited(req, 'newssave', 60)) { sendJson(res, 429, { error: 'Demasiados cambios seguidos. Prueba en un rato.' }); return true; }
      addHit(req, 'newssave', 60 * 60 * 1000);
      const b = await readJson(req);
      const title = clean(b.title, 150);
      const body = String(b.body == null ? '' : b.body).replace(/\r\n/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, 8000);
      const category = NEWS_CATS.includes(b.category) ? b.category : 'noticia';
      const eventAt = Number.isSafeInteger(b.eventAt) && b.eventAt > 0 && b.eventAt < 4102444800000 ? b.eventAt : 0;
      if (title.length < 3) { sendJson(res, 400, { error: 'El título debe tener al menos 3 caracteres.' }); return true; }
      if (body.length < 10) { sendJson(res, 400, { error: 'El contenido debe tener al menos 10 caracteres.' }); return true; }
      const published = b.published === false ? 0 : 1, pinned = b.pinned === true ? 1 : 0;
      const now = Date.now();
      const id = int(b.id, 1, 1e12);
      if (id) {
        const o = db.prepare('SELECT * FROM news WHERE id = ?').get(id);
        if (!o) { sendJson(res, 404, { error: 'Esa noticia no existe.' }); return true; }
        tx(() => {
          db.prepare('UPDATE news SET title = ?, body = ?, category = ?, event_at = ?, published = ?, pinned = ?, updated_at = ? WHERE id = ?').run(title, body, category, eventAt, published, pinned, now, id);
          audit(me, 'noticia_modificada', { type: 'noticia', id }, { titulo: o.title, publicada: !!o.published }, { titulo: title, publicada: !!published }, 'Noticias', 'ok', req);
        });
        sendJson(res, 200, { ok: true, id });
        return true;
      }
      const nid = tx(() => {
        const r = db.prepare('INSERT INTO news (title, body, category, event_at, published, pinned, author_id, author, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(title, body, category, eventAt, published, pinned, me.id, me.alias, now, now);
        audit(me, 'noticia_publicada', { type: 'noticia', id: Number(r.lastInsertRowid) }, null, { titulo: title, publicada: !!published }, 'Noticias', 'ok', req);
        return Number(r.lastInsertRowid);
      });
      sendJson(res, 201, { ok: true, id: nid });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/news/delete') {
      if (!need('news.manage')) return true;
      const b = await readJson(req);
      const id = int(b.id, 1, 1e12);
      const o = id ? db.prepare('SELECT * FROM news WHERE id = ?').get(id) : null;
      if (!o) { sendJson(res, 404, { error: 'Esa noticia no existe.' }); return true; }
      tx(() => {
        db.prepare('DELETE FROM news WHERE id = ?').run(id);
        audit(me, 'noticia_eliminada', { type: 'noticia', id }, { titulo: o.title }, null, 'Noticias', 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Respaldo de la base de datos (solo superadministrador) ----- */
    if (pathname.startsWith('/api/admin/backup')) {
      if (!need('backup.manage')) return true;
      const bk = require('./backup');
      if (method === 'GET' && pathname === '/api/admin/backup/list') {
        sendJson(res, 200, { backups: bk.listLocal(), external: !!bk.s3cfg(), everyHours: Number(process.env.BACKUP_EVERY_HOURS) || 24, keep: Number(process.env.BACKUP_KEEP) || 14 });
        return true;
      }
      if (method === 'POST' && pathname === '/api/admin/backup/run') {
        if (isLimited(req, 'backup', 6)) { sendJson(res, 429, { error: 'Demasiados respaldos seguidos. Espera un poco.' }); return true; }
        addHit(req, 'backup', 60 * 60 * 1000);
        try {
          const r = await bk.backupNow(db);
          audit(me, 'respaldo_creado', { type: 'respaldo' }, null, { archivo: r.file, externo: r.uploaded }, 'Respaldo manual', 'ok', req);
          sendJson(res, 200, Object.assign({ ok: true }, r));
        } catch (e) { sendJson(res, 500, { error: 'No se pudo crear el respaldo.' }); }
        return true;
      }
      if (method === 'GET' && pathname === '/api/admin/backup/download') {
        const f = get('file');
        if (!/^ladder-[0-9T-]+\.sqlite\.gz$/.test(f)) { sendJson(res, 400, { error: 'Archivo no válido.' }); return true; }
        const full = require('node:path').join(bk.backupDir(), f);
        if (!require('node:fs').existsSync(full)) { sendJson(res, 404, { error: 'Ese respaldo no existe.' }); return true; }
        audit(me, 'respaldo_descargado', { type: 'respaldo' }, null, { archivo: f }, 'Descarga de respaldo', 'ok', req);
        res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="' + f + '"', 'Cache-Control': 'no-store' });
        require('node:fs').createReadStream(full).pipe(res);
        return true;
      }
      sendJson(res, 404, { error: 'No encontrado.' });
      return true;
    }

    /* ----- Links (banners de otras páginas en la barra lateral) ----- */
    if (method === 'POST' && pathname === '/api/admin/links/save') {
      if (!need('config.edit')) return true;
      const b = await readJson(req, 600 * 1024);
      const title = clean(b.title, 60);
      let url = '';
      try { const u = new URL(clean(b.url, 400)); url = u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch (_) { url = ''; }
      let image = typeof b.image === 'string' ? b.image.trim() : '';
      if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) { if (image.length > 400000) { sendJson(res, 400, { error: 'La imagen es muy pesada (máximo ~250 KB).' }); return true; } }
      else { try { const u = new URL(image); image = u.protocol === 'https:' ? u.href : ''; } catch (_) { image = ''; } }
      if (title.length < 2) { sendJson(res, 400, { error: 'Escribe un nombre para el link.' }); return true; }
      if (!url) { sendJson(res, 400, { error: 'El enlace debe empezar con https:// (o http://).' }); return true; }
      const id = int(b.id, 1, 1e12);
      if (id) {
        const o = db.prepare('SELECT image FROM site_links WHERE id = ?').get(id);
        if (!o) { sendJson(res, 404, { error: 'Ese link no existe.' }); return true; }
        if (!image) image = o.image;
        tx(() => { db.prepare('UPDATE site_links SET title = ?, url = ?, image = ? WHERE id = ?').run(title, url, image, id); audit(me, 'link_modificado', { type: 'link', id }, null, { titulo: title }, 'Links', 'ok', req); });
        sendJson(res, 200, { ok: true, id }); return true;
      }
      if (!image) { sendJson(res, 400, { error: 'Sube una imagen o pega su enlace (https://…).' }); return true; }
      if (db.prepare('SELECT COUNT(*) AS n FROM site_links').get().n >= 30) { sendJson(res, 409, { error: 'Máximo 30 links.' }); return true; }
      const nid = tx(() => {
        const mx = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM site_links').get().m;
        const r = db.prepare('INSERT INTO site_links (title, url, image, sort, created_at) VALUES (?,?,?,?,?)').run(title, url, image, mx + 1, Date.now());
        audit(me, 'link_agregado', { type: 'link', id: Number(r.lastInsertRowid) }, null, { titulo: title }, 'Links', 'ok', req);
        return Number(r.lastInsertRowid);
      });
      sendJson(res, 201, { ok: true, id: nid }); return true;
    }
    if (method === 'POST' && pathname === '/api/admin/links/delete') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const id = int(b.id, 1, 1e12);
      const o = id ? db.prepare('SELECT title FROM site_links WHERE id = ?').get(id) : null;
      if (!o) { sendJson(res, 404, { error: 'Ese link no existe.' }); return true; }
      tx(() => { db.prepare('DELETE FROM site_links WHERE id = ?').run(id); audit(me, 'link_eliminado', { type: 'link', id }, { titulo: o.title }, null, 'Links', 'ok', req); });
      sendJson(res, 200, { ok: true }); return true;
    }
    if (method === 'POST' && pathname === '/api/admin/links/move') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const id = int(b.id, 1, 1e12), dir = b.dir === 'up' ? -1 : 1;
      const rows = db.prepare('SELECT id FROM site_links ORDER BY sort, id').all();
      const i = rows.findIndex((r) => r.id === id), j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) { sendJson(res, 200, { ok: true }); return true; }
      [rows[i], rows[j]] = [rows[j], rows[i]];
      tx(() => { rows.forEach((r, k) => db.prepare('UPDATE site_links SET sort = ? WHERE id = ?').run(k + 1, r.id)); });
      sendJson(res, 200, { ok: true }); return true;
    }

    /* ----- Descargas para jugadores nuevos ----- */
    const DL_CATS = ['juego', 'parche', 'expansion', 'mapas', 'mod', 'herramienta'];
    if (method === 'POST' && pathname === '/api/admin/downloads/save') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const title = clean(b.title, 90), description = clean(b.description, 400), info = clean(b.info, 40);
      const category = DL_CATS.includes(b.category) ? b.category : 'juego';
      let url = '';
      try { const u = new URL(clean(b.url, 400)); url = u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch (_) { url = ''; }
      if (title.length < 3) { sendJson(res, 400, { error: 'Escribe un título (mínimo 3 caracteres).' }); return true; }
      if (!url) { sendJson(res, 400, { error: 'El enlace debe empezar con https:// (o http://).' }); return true; }
      const id = int(b.id, 1, 1e12);
      if (id) {
        const o = db.prepare('SELECT id FROM downloads WHERE id = ?').get(id);
        if (!o) { sendJson(res, 404, { error: 'Esa descarga no existe.' }); return true; }
        tx(() => { db.prepare('UPDATE downloads SET title=?, url=?, category=?, description=?, info=? WHERE id=?').run(title, url, category, description, info, id); audit(me, 'descarga_modificada', { type: 'descarga', id }, null, { titulo: title }, 'Descargas', 'ok', req); });
        sendJson(res, 200, { ok: true, id }); return true;
      }
      if (db.prepare('SELECT COUNT(*) AS n FROM downloads').get().n >= 100) { sendJson(res, 409, { error: 'Máximo 100 descargas.' }); return true; }
      const nid = tx(() => {
        const r = db.prepare('INSERT INTO downloads (title, url, category, description, info, sort, created_at) VALUES (?,?,?,?,?,?,?)').run(title, url, category, description, info, DL_CATS.indexOf(category), Date.now());
        audit(me, 'descarga_agregada', { type: 'descarga', id: Number(r.lastInsertRowid) }, null, { titulo: title }, 'Descargas', 'ok', req);
        return Number(r.lastInsertRowid);
      });
      sendJson(res, 201, { ok: true, id: nid }); return true;
    }
    if (method === 'POST' && pathname === '/api/admin/downloads/delete') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const id = int(b.id, 1, 1e12);
      const o = id ? db.prepare('SELECT title FROM downloads WHERE id = ?').get(id) : null;
      if (!o) { sendJson(res, 404, { error: 'Esa descarga no existe.' }); return true; }
      tx(() => { db.prepare('DELETE FROM downloads WHERE id = ?').run(id); audit(me, 'descarga_eliminada', { type: 'descarga', id }, { titulo: o.title }, null, 'Descargas', 'ok', req); });
      sendJson(res, 200, { ok: true }); return true;
    }

    /* ----- Servers online (lista de servidores MOHAA) ----- */
    if (method === 'GET' && pathname === '/api/admin/servers') {
      if (!need('panel.view')) return true;
      sendJson(res, 200, { canEdit: can(me, 'config.edit'), servers: serversCfg.get().map((s) => ({ name: s.name, address: s.host + ':' + s.port })) });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/servers') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const r = serversCfg.save(b.servers);
      if (r.error) { sendJson(res, 400, { error: r.error }); return true; }
      audit(me, 'servidores_actualizados', { type: 'config', id: 0 }, null, { cantidad: r.servers.length }, 'Lista de servers online', 'ok', req);
      sendJson(res, 200, { ok: true, servers: r.servers.map((s) => ({ name: s.name, address: s.host + ':' + s.port })) });
      return true;
    }

    /* ----- Configuración de plazos y reglas ----- */
    if (method === 'GET' && pathname === '/api/admin/config') {
      if (!need('panel.view')) return true;
      sendJson(res, 200, { unreportedHours: hoursCfg(), disputeCounts: config('dispute_counts', 'loss'), canEdit: can(me, 'config.edit') });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/config') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const hrs = int(b.unreportedHours, 1, 720), dc = b.disputeCounts === 'none' ? 'none' : b.disputeCounts === 'loss' ? 'loss' : '';
      if (!hrs || !dc) { sendJson(res, 400, { error: 'Revisa los valores: el plazo va de 1 a 720 horas.' }); return true; }
      const old = { unreportedHours: hoursCfg(), disputeCounts: config('dispute_counts', 'loss') };
      tx(() => {
        st.cfgSet.run('unreported_hours', String(hrs)); st.cfgSet.run('dispute_counts', dc);
        if (old.disputeCounts !== dc) recompute();
        audit(me, 'config_cambiada', { type: 'configuración' }, old, { unreportedHours: hrs, disputeCounts: dc }, reason, 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }


    /* ===== Parte 3: jugadores, clanes y líderes ===== */
    const RANK = { '': 0, news: 0, moderator: 1, admin: 2, superadmin: 3 };
    const CLAN_ROLES = ['leader', 'coleader', 'captain', 'member'];
    const ROLE_ES = { leader: 'Líder', coleader: 'Colíder', captain: 'Capitán', member: 'Miembro' };
    const esc = (t) => t.replace(/[\\%_]/g, (c) => '\\' + c);
    const playerRow = (id) => db.prepare('SELECT * FROM players WHERE id = ?').get(id);
    const clanOf = (pid) => db.prepare('SELECT cm.clan_id, cm.role, c.name FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.player_id = ?').get(pid);
    const recOf = (pid) => { const r = playerRecord(pid, q.playerRecord.all(pid)); return { wins: r[0].n, losses: r[1].n }; };
    const pct = (w, l) => (w + l ? Math.round((w * 1000) / (w + l)) / 10 : 0);
    // Un administrador no puede tocar a quien tenga un rol igual o superior (salvo el superadministrador).
    const protectedTarget = (t) => role !== 'superadmin' && RANK[roleOf(t)] >= RANK[role];
    const needReason = (b) => { const r = reasonOf(b); return r.length >= 5 ? r : null; };
    const isAdminAlias = (a) => ADMINS.has(String(a).toLowerCase());
    const notesFor = (type, id) => db.prepare('SELECT * FROM admin_notes WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 100').all(type, id).map((n) => ({ id: n.id, text: n.body, by: n.by_alias, at: n.created_at, public: !!n.public }));
    const auditFor = (col, id) => db.prepare('SELECT id, at, actor_alias, action, old_json, new_json, reason, result FROM audit_log WHERE ' + col + ' = ? ORDER BY id DESC LIMIT 40').all(id)
      .map((r) => ({ id: r.id, at: r.at, actor: r.actor_alias, action: r.action, old: r.old_json, new: r.new_json, reason: r.reason, result: r.result }));
    const seaId = () => { const s2 = q.activeSeason.get(); return s2 ? s2.id : 0; };

    if (method === 'GET' && pathname === '/api/admin/players') {
      if (!need('players.view')) return true;
      const where = ['1=1'], args = [];
      const term = clean(get('q'), 40);
      if (term) { const like = '%' + esc(term) + '%'; where.push("(p.alias LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'" + (/^\d+$/.test(term) ? ' OR p.id = ?' : '') + ')'); args.push(like, like); if (/^\d+$/.test(term)) args.push(Number(term)); }
      if (get('status') === 'active') where.push('p.active = 1'); else if (get('status') === 'inactive') where.push('p.active = 0'); else if (get('status') === 'staff') where.push("p.admin_role <> ''");
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const base = ' FROM players p LEFT JOIN clan_members cm ON cm.player_id = p.id LEFT JOIN clans c ON c.id = cm.clan_id WHERE ' + where.join(' AND ');
      const total = db.prepare('SELECT COUNT(*) AS n' + base).get(...args).n;
      const rows = db.prepare('SELECT p.id, p.alias, p.active, p.admin_role, p.created_at, c.id AS cid, c.name AS cname, cm.role AS crole' + base + ' ORDER BY p.alias COLLATE NOCASE LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, players: rows.map((r) => { const rc = recOf(r.id); return { id: r.id, alias: r.alias, active: !!r.active, staff: r.admin_role, clanId: r.cid || 0, clan: r.cname || '', clanRole: r.crole || '', joined: r.created_at, wins: rc.wins, losses: rc.losses }; }) });
      return true;
    }

    if (method === 'GET' && pathname === '/api/admin/player') {
      if (!need('players.view')) return true;
      const t = playerRow(int(get('id'), 1, 1e12) || 0);
      if (!t) { sendJson(res, 404, { error: 'Ese jugador no existe.' }); return true; }
      const cl = clanOf(t.id), rc = recOf(t.id), sid = seaId();
      const hist = db.prepare("SELECT m.id, m.status, m.winner_id, m.loser_id, m.season_id, COALESCE(NULLIF(m.played_at,0), NULLIF(m.resolved_at,0), m.created_at) AS d, mp.side, w.name AS wn, l.name AS ln FROM match_players mp JOIN matches m ON m.id = mp.match_id JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id WHERE mp.player_id = ? AND m.status <> 'deleted' ORDER BY d DESC, m.id DESC LIMIT 60").all(t.id);
      const adjs = db.prepare('SELECT * FROM player_adjust WHERE player_id = ? ORDER BY id DESC LIMIT 30').all(t.id);
      sendJson(res, 200, {
        player: { id: t.id, alias: t.alias, email: can(me, 'players.edit') ? t.email : '', created: t.created_at, verified: !!t.verified, active: !!t.active, staff: t.admin_role, icq: t.icq, aim: t.aim, msn: t.msn, website: t.website, locked: isAdminAlias(t.alias) },
        clan: cl ? { id: cl.clan_id, name: cl.name, role: cl.role } : null,
        stats: { wins: rc.wins, losses: rc.losses, pct: pct(rc.wins, rc.losses), draws: 0, seasonActive: !!sid },
        matches: hist.map((h) => ({ id: h.id, date: h.d, side: h.side, status: h.status, winner: h.wn, loser: h.ln, current: h.season_id === sid })),
        adjustments: adjs.map((a) => ({ id: a.id, wins: a.wins_delta, losses: a.losses_delta, reason: a.reason, by: a.by_alias, at: a.created_at, revoked: !!a.revoked_at, current: a.season_id === sid })),
        notes: can(me, 'reports.review') ? notesFor('player', t.id) : [], history: auditFor('player_id', t.id),
        sanctions: can(me, 'sanctions.view') ? db.prepare("SELECT * FROM sanctions WHERE target_type = 'player' AND player_id = ? ORDER BY id DESC LIMIT 30").all(t.id).map((sa) => Object.assign(sanctionLine(sa), { reason: reasonLabel(sa.reason_code) })) : [],
        complaints: can(me, 'complaints.manage') ? db.prepare('SELECT id, status, created_at, accuser_id FROM complaints WHERE accused_id = ? ORDER BY id DESC LIMIT 20').all(t.id).map((c) => ({ id: c.id, status: c.status, at: c.created_at, role: 'denunciado' })).concat(db.prepare('SELECT id, status, created_at FROM complaints WHERE accuser_id = ? ORDER BY id DESC LIMIT 20').all(t.id).map((c) => ({ id: c.id, status: c.status, at: c.created_at, role: 'denunciante' }))) : [],
        canSanction: can(me, 'sanctions.warn') && !protectedTarget(t),
        canEdit: can(me, 'players.edit') && !protectedTarget(t), canAdjust: can(me, 'stats.adjust') && !protectedTarget(t), canNote: can(me, 'reports.review'), self: t.id === me.id,
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/admin/player/update') {
      if (!need('players.edit')) return true;
      const b = await readJson(req);
      const t = playerRow(parseInt(b.id, 10) || 0);
      if (!t) { sendJson(res, 404, { error: 'Ese jugador no existe.' }); return true; }
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      if (protectedTarget(t)) return deny('players.edit'), true;
      const fail = (st2, msg) => { sendJson(res, st2, { error: msg }); return true; };
      const act = b.action;
      const info = { type: 'jugador', id: t.id, player: t.id };
      try {
        if (act === 'rename') {
          const alias = clean(b.alias, 40);
          if (alias.length < 3 || alias.length > 24) return fail(400, 'El nombre debe tener entre 3 y 24 caracteres.');
          if (isAdminAlias(t.alias) || isAdminAlias(alias)) return fail(409, 'Ese nombre está reservado para un superadministrador de la configuración del servidor.');
          if (alias === t.alias) return fail(409, 'Ese ya es su nombre.');
          tx(() => { db.prepare('UPDATE players SET alias = ? WHERE id = ?').run(alias, t.id); audit(me, 'jugador_renombrado', Object.assign({ clan: (clanOf(t.id) || {}).clan_id || 0 }, info), { alias: t.alias }, { alias }, reason, 'ok', req); });
        } else if (act === 'set_active') {
          const active = b.active === true ? 1 : 0;
          if (t.id === me.id) return fail(409, 'No puedes desactivar tu propia cuenta.');
          if (isAdminAlias(t.alias)) return fail(409, 'Un superadministrador fijo del servidor no se puede desactivar desde el panel.');
          if (t.active === active) return fail(409, active ? 'La cuenta ya está activa.' : 'La cuenta ya está desactivada.');
          tx(() => { db.prepare('UPDATE players SET active = ? WHERE id = ?').run(active, t.id); if (!active) db.prepare('DELETE FROM sessions WHERE player_id = ?').run(t.id); audit(me, active ? 'cuenta_activada' : 'cuenta_desactivada', info, { activa: !!t.active }, { activa: !!active }, reason, 'ok', req); });
        } else if (act === 'move_clan' || act === 'set_role') {
          const cur = clanOf(t.id);
          const newRole = CLAN_ROLES.includes(b.role) ? b.role : 'member';
          const targetClan = act === 'set_role' ? (cur ? cur.clan_id : 0) : (int(b.clanId, 0, 1e12) || 0);
          if (act === 'set_role' && !cur) return fail(409, 'Ese jugador no pertenece a ningún clan.');
          if (targetClan && !q.clanById.get(targetClan)) return fail(404, 'Ese clan no existe.');
          const leadersOf = (cid) => db.prepare("SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ? AND role = 'leader' AND player_id <> ?").get(cid, t.id).n;
          if (cur && (targetClan !== cur.clan_id || newRole !== cur.role)) {
            if (cur.role === 'leader' && leadersOf(cur.clan_id) === 0 && (targetClan !== cur.clan_id || newRole !== 'leader')) {
              const others = db.prepare('SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ? AND player_id <> ?').get(cur.clan_id, t.id).n;
              if (others > 0 || targetClan !== cur.clan_id) return fail(409, 'Es el único Líder de su clan. Primero designa a otro Líder en la ficha del clan.');
            }
          }
          if (!cur && !targetClan) return fail(409, 'Ese jugador ya está sin clan.');
          if (cur && targetClan === cur.clan_id && newRole === cur.role) return fail(409, 'No hay cambios que guardar.');
          if (targetClan && (!cur || targetClan !== cur.clan_id) && db.prepare('SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ?').get(targetClan).n >= 12) return fail(409, 'Ese clan ya tiene 12 integrantes.');
          tx(() => {
            if (cur) db.prepare('DELETE FROM clan_members WHERE player_id = ?').run(t.id);
            if (targetClan) { db.prepare('INSERT INTO clan_members (clan_id, player_id, role, joined_at) VALUES (?,?,?,?)').run(targetClan, t.id, newRole, Date.now()); db.prepare('DELETE FROM clan_invites WHERE player_id = ?').run(t.id); }
            audit(me, act === 'set_role' ? 'rol_clan_cambiado' : 'clan_cambiado', Object.assign({ clan: targetClan || (cur ? cur.clan_id : 0) }, info),
              { clan: cur ? cur.name : '', rol: cur ? cur.role : '' }, { clan: targetClan ? q.clanById.get(targetClan).name : '', rol: targetClan ? newRole : '' }, reason, 'ok', req);
          });
        } else return fail(400, 'Acción no válida.');
      } catch (e) {
        if (String(e && e.message).includes('UNIQUE')) return fail(409, 'Ese nombre ya está en uso.');
        console.error(e); return fail(500, 'No se pudo completar el cambio.');
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Ajustes administrativos de estadísticas (jugador o clan) ----- */
    if (method === 'POST' && (pathname === '/api/admin/player/adjust' || pathname === '/api/admin/clan/adjust')) {
      if (!need('stats.adjust')) return true;
      const b = await readJson(req);
      const isClan = pathname.includes('/clan/');
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      if (b.confirm !== true) { sendJson(res, 400, { error: 'Falta la confirmación.' }); return true; }
      const sid = seaId();
      if (!sid) { sendJson(res, 409, { error: 'No hay una temporada activa.' }); return true; }
      const key = clean(b.key, 60);
      if (key.length < 8) { sendJson(res, 400, { error: 'Solicitud incompleta. Recarga la página.' }); return true; }
      const dw = int(b.winsDelta, -50, 50), dl = int(b.lossesDelta, -50, 50);
      if (dw === null || dl === null || (dw === 0 && dl === 0)) { sendJson(res, 400, { error: 'Indica cuántas victorias o derrotas sumar o restar (entre -50 y 50).' }); return true; }
      const tid = int(b.id, 1, 1e12) || 0;
      let before, after;
      try {
        tx(() => {
          if (Number(st.idem.run('adj:' + key, Date.now()).changes) !== 1) throw { dup: true };
          if (isClan) {
            const c = q.clanById.get(tid); if (!c) throw { msg: 'Ese clan no existe.' };
            if (c.wins + dw < 0 || c.losses + dl < 0) throw { msg: 'El ajuste dejaría victorias o derrotas por debajo de cero.' };
            before = { victorias: c.wins, derrotas: c.losses };
            db.prepare('INSERT INTO clan_adjust (clan_id, season_id, wins_delta, losses_delta, reason, by_alias, created_at) VALUES (?,?,?,?,?,?,?)').run(c.id, sid, dw, dl, reason, me.alias, Date.now());
            recompute();
            const c2 = q.clanById.get(c.id); after = { victorias: c2.wins, derrotas: c2.losses };
            audit(me, 'ajuste_estadisticas_clan', { type: 'clan', id: c.id, clan: c.id }, before, after, reason, 'ok', req);
          } else {
            const t = playerRow(tid); if (!t) throw { msg: 'Ese jugador no existe.' };
            if (protectedTarget(t)) throw { msg: 'No tienes permiso sobre ese jugador.' };
            const rc = recOf(t.id);
            if (rc.wins + dw < 0 || rc.losses + dl < 0) throw { msg: 'El ajuste dejaría victorias o derrotas por debajo de cero.' };
            before = { victorias: rc.wins, derrotas: rc.losses };
            db.prepare('INSERT INTO player_adjust (player_id, season_id, wins_delta, losses_delta, reason, by_alias, created_at) VALUES (?,?,?,?,?,?,?)').run(t.id, sid, dw, dl, reason, me.alias, Date.now());
            const r2 = recOf(t.id); after = { victorias: r2.wins, derrotas: r2.losses };
            audit(me, 'ajuste_estadisticas_jugador', { type: 'jugador', id: t.id, player: t.id, clan: (clanOf(t.id) || {}).clan_id || 0 }, before, after, reason, 'ok', req);
          }
        });
      } catch (e) {
        if (e && e.dup) { sendJson(res, 409, { error: 'Este ajuste ya se registró.' }); return true; }
        if (e && e.msg) { sendJson(res, 400, { error: e.msg }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo registrar el ajuste.' }); return true;
      }
      sendJson(res, 201, { ok: true, before, after });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/adjust/revoke') {
      if (!need('stats.adjust')) return true;
      const b = await readJson(req);
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const isClan = b.kind === 'clan';
      const row = db.prepare('SELECT * FROM ' + (isClan ? 'clan_adjust' : 'player_adjust') + ' WHERE id = ?').get(parseInt(b.id, 10) || 0);
      if (!row) { sendJson(res, 404, { error: 'Ese ajuste no existe.' }); return true; }
      if (row.revoked_at) { sendJson(res, 409, { error: 'Ese ajuste ya fue revertido.' }); return true; }
      if (row.season_id !== seaId()) { sendJson(res, 409, { error: 'Ese ajuste es de una temporada cerrada.' }); return true; }
      tx(() => {
        db.prepare('UPDATE ' + (isClan ? 'clan_adjust' : 'player_adjust') + ' SET revoked_at = ? WHERE id = ? AND revoked_at = 0').run(Date.now(), row.id);
        if (isClan) recompute();
        audit(me, isClan ? 'ajuste_clan_revertido' : 'ajuste_jugador_revertido', isClan ? { type: 'clan', id: row.clan_id, clan: row.clan_id } : { type: 'jugador', id: row.player_id, player: row.player_id },
          { victorias: row.wins_delta, derrotas: row.losses_delta }, { revertido: true }, reason, 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Notas privadas de jugadores y clanes ----- */
    if (method === 'POST' && pathname === '/api/admin/note') {
      if (!need('reports.review')) return true;
      const b = await readJson(req);
      const type = ['clan', 'player', 'complaint', 'disc', 'sanction'].includes(b.targetType) ? b.targetType : '';
      const tid = int(b.targetId, 1, 1e12) || 0;
      const text = clean(b.text, 1000);
      const key = clean(b.key, 60);
      const exists = type === 'clan' ? q.clanById.get(tid) : type === 'player' ? playerRow(tid) : type === 'complaint' ? db.prepare('SELECT 1 FROM complaints WHERE id = ?').get(tid) : type === 'disc' ? db.prepare('SELECT 1 FROM disc_reports WHERE id = ?').get(tid) : db.prepare('SELECT 1 FROM sanctions WHERE id = ?').get(tid);
      if (!type || !exists) { sendJson(res, 404, { error: 'No existe ese registro.' }); return true; }
      if (type !== 'clan' && type !== 'player' && !need(type === 'complaint' ? 'complaints.manage' : type === 'disc' ? 'disc.view' : 'sanctions.view')) return true;
      if (text.length < 3) { sendJson(res, 400, { error: 'Escribe la nota (al menos 3 caracteres).' }); return true; }
      if (key.length < 8) { sendJson(res, 400, { error: 'Solicitud incompleta. Recarga la página.' }); return true; }
      try {
        tx(() => {
          if (Number(st.idem.run('anote:' + key, Date.now()).changes) !== 1) throw { dup: true };
          db.prepare('INSERT INTO admin_notes (target_type, target_id, body, by_alias, created_at, public) VALUES (?,?,?,?,?,?)').run(type, tid, text, me.alias, Date.now(), type === 'player' && b.public ? 1 : 0);
          audit(me, 'nota_privada', type === 'clan' ? { type: 'clan', id: tid, clan: tid } : type === 'player' ? { type: 'jugador', id: tid, player: tid } : { type: { complaint: 'denuncia', disc: 'reporte disciplinario', sanction: 'sanción' }[type], id: tid }, null, { texto: text.slice(0, 200) }, '', 'ok', req);
        });
      } catch (e) {
        if (e && e.dup) { sendJson(res, 409, { error: 'Esa nota ya se guardó.' }); return true; }
        console.error(e); sendJson(res, 500, { error: 'No se pudo guardar la nota.' }); return true;
      }
      sendJson(res, 201, { ok: true });
      return true;
    }

    /* ----- Clanes ----- */
    if (method === 'GET' && pathname === '/api/admin/clans') {
      if (!need('clans.view')) return true;
      const term = clean(get('q'), 40), like = '%' + esc(term) + '%';
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const base = " FROM clans c WHERE c.name LIKE ? ESCAPE '\\'" + (/^\d+$/.test(term) ? ' OR c.id = ' + Number(term) : '');
      const total = db.prepare('SELECT COUNT(*) AS n' + base).get(like).n;
      const rows = db.prepare("SELECT c.id, c.name, c.tag, c.wins, c.losses, c.created_at, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members, (SELECT COUNT(*) FROM matches x WHERE x.status IN ('pending','disputed') AND (x.winner_id = c.id OR x.loser_id = c.id)) AS pend, (SELECT p.alias FROM clan_members m JOIN players p ON p.id = m.player_id WHERE m.clan_id = c.id AND m.role = 'leader' ORDER BY m.joined_at LIMIT 1) AS leader" + base + ' ORDER BY c.name COLLATE NOCASE LIMIT ? OFFSET ?').all(like, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, clans: rows.map((c) => ({ id: c.id, name: c.name, tag: c.tag, wins: c.wins, losses: c.losses, members: c.members, pending: c.pend, leader: c.leader || '', created: c.created_at })) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/admin/clan') {
      if (!need('clans.view')) return true;
      const c = q.clanById.get(int(get('id'), 1, 1e12) || 0);
      if (!c) { sendJson(res, 404, { error: 'Ese clan no existe.' }); return true; }
      const members = q.clanMembers.all(c.id).map((m) => { const rc = recOf(m.id); return { id: m.id, alias: m.alias, role: m.role, joined: m.joined_at, wins: rc.wins, losses: rc.losses }; });
      const ms = db.prepare("SELECT m.id, m.status, m.winner_id, m.loser_id, COALESCE(NULLIF(m.played_at,0), NULLIF(m.resolved_at,0), m.created_at) AS d, w.name AS wn, l.name AS ln FROM matches m JOIN clans w ON w.id = m.winner_id JOIN clans l ON l.id = m.loser_id WHERE (m.winner_id = ? OR m.loser_id = ?) AND m.status <> 'deleted' ORDER BY d DESC, m.id DESC LIMIT 40").all(c.id, c.id);
      const adjs = db.prepare('SELECT * FROM clan_adjust WHERE clan_id = ? ORDER BY id DESC LIMIT 30').all(c.id);
      sendJson(res, 200, {
        clan: { id: c.id, name: c.name, tag: c.tag, website: c.website, logo: c.logo, wins: c.wins, losses: c.losses, streak: c.streak, created: c.created_at, pct: pct(c.wins, c.losses) },
        members, matches: ms.map((x) => ({ id: x.id, status: x.status, date: x.d, winner: x.wn, loser: x.ln, open: x.status === 'pending' || x.status === 'disputed' })),
        adjustments: adjs.map((a) => ({ id: a.id, wins: a.wins_delta, losses: a.losses_delta, reason: a.reason, by: a.by_alias, at: a.created_at, revoked: !!a.revoked_at, current: a.season_id === seaId() })),
        notes: can(me, 'reports.review') ? notesFor('clan', c.id) : [], history: auditFor('clan_id', c.id),
        sanctions: can(me, 'sanctions.view') ? db.prepare("SELECT * FROM sanctions WHERE target_type = 'clan' AND clan_id = ? ORDER BY id DESC LIMIT 30").all(c.id).map((sa) => Object.assign(sanctionLine(sa), { reason: reasonLabel(sa.reason_code) })) : [],
        discs: can(me, 'disc.view') ? db.prepare('SELECT d.id, d.status, d.reason, d.severity, d.created_at, p.alias AS leader FROM disc_reports d JOIN players p ON p.id = d.leader_id WHERE d.clan_id = ? ORDER BY d.id DESC LIMIT 30').all(c.id).map((d) => ({ id: d.id, status: d.status, reason: d.reason, severity: d.severity, at: d.created_at, leader: d.leader })) : [],
        suspended: clanBlocked(c.id), canSanction: can(me, 'sanctions.warn'),
        canEdit: can(me, 'clans.edit'), canAdjust: can(me, 'stats.adjust'), canNote: can(me, 'reports.review'),
      });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/clan/update') {
      if (!need('clans.edit')) return true;
      const b = await readJson(req);
      const c = q.clanById.get(parseInt(b.id, 10) || 0);
      if (!c) { sendJson(res, 404, { error: 'Ese clan no existe.' }); return true; }
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const name = clean(b.name, 60), tag = clean(b.tag, 20), website = clean(b.website, 300) ? evUrl(b.website) : '', logo = clean(b.logo, 300) ? evUrl(b.logo) : '';
      if (name.length < 3 || name.length > 30) { sendJson(res, 400, { error: 'El nombre del clan debe tener entre 3 y 30 caracteres.' }); return true; }
      if (tag.length > 8) { sendJson(res, 400, { error: 'El tag puede tener hasta 8 caracteres.' }); return true; }
      if (website === null || logo === null) { sendJson(res, 400, { error: 'Los enlaces deben empezar con http:// o https://.' }); return true; }
      const o = { nombre: c.name, tag: c.tag, web: c.website, logo: c.logo }, n = { nombre: name, tag, web: website, logo };
      if (JSON.stringify(o) === JSON.stringify(n)) { sendJson(res, 409, { error: 'No hay cambios que guardar.' }); return true; }
      try { tx(() => { q.updateClan.run(name, tag, website, logo, c.id); audit(me, 'clan_modificado', { type: 'clan', id: c.id, clan: c.id }, o, n, reason, 'ok', req); }); }
      catch (e) { sendJson(res, 409, { error: 'Ya existe un clan con ese nombre.' }); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/clan/leader') {
      if (!need('clans.edit')) return true;
      const b = await readJson(req);
      const c = q.clanById.get(parseInt(b.id, 10) || 0);
      if (!c) { sendJson(res, 404, { error: 'Ese clan no existe.' }); return true; }
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const mem = db.prepare('SELECT player_id, role FROM clan_members WHERE clan_id = ? AND player_id = ?').get(c.id, parseInt(b.playerId, 10) || 0);
      if (!mem) { sendJson(res, 404, { error: 'Ese jugador no es integrante del clan.' }); return true; }
      const t = playerRow(mem.player_id);
      if (protectedTarget(t)) return deny('clans.edit'), true;
      const act = b.action;
      try {
        tx(() => {
          const setRole = (pid, r) => db.prepare('UPDATE clan_members SET role = ? WHERE clan_id = ? AND player_id = ?').run(r, c.id, pid);
          const info = { type: 'clan', id: c.id, clan: c.id, player: t.id };
          if (act === 'set_main') {
            if (mem.role === 'leader' && db.prepare("SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ? AND role = 'leader'").get(c.id).n === 1) throw { msg: 'Ya es el único Líder.' };
            const demote = b.demoteTo === 'member' ? 'member' : 'coleader';
            const prev = db.prepare("SELECT player_id FROM clan_members WHERE clan_id = ? AND role = 'leader' AND player_id <> ?").all(c.id, t.id).map((x) => x.player_id);
            prev.forEach((pid) => setRole(pid, demote)); setRole(t.id, 'leader');
            audit(me, 'lider_principal_cambiado', info, { lideres: prev, rolAnterior: mem.role }, { lider: t.alias, anterioresPasan: demote }, reason, 'ok', req);
          } else if (act === 'set_co') {
            if (mem.role === 'coleader' || mem.role === 'leader') throw { msg: 'Ya tiene un rango de liderazgo.' };
            setRole(t.id, 'coleader'); audit(me, 'colider_designado', info, { rol: mem.role }, { rol: 'coleader' }, reason, 'ok', req);
          } else if (act === 'revoke_co') {
            if (mem.role !== 'coleader') throw { msg: 'Ese jugador no es Colíder.' };
            setRole(t.id, 'member'); audit(me, 'colider_revocado', info, { rol: 'coleader' }, { rol: 'member' }, reason, 'ok', req);
          } else throw { msg: 'Acción no válida.' };
        });
      } catch (e) { if (e && e.msg) { sendJson(res, 400, { error: e.msg }); return true; } console.error(e); sendJson(res, 500, { error: 'No se pudo completar el cambio.' }); return true; }
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Líderes de clan ----- */
    if (method === 'GET' && pathname === '/api/admin/leaders') {
      if (!need('clans.view')) return true;
      const term = clean(get('q'), 40), like = '%' + esc(term) + '%';
      const rows = db.prepare("SELECT cm.role, p.id AS pid, p.alias, p.active, c.id AS cid, c.name, (SELECT COUNT(*) FROM matches m WHERE m.status = 'pending' AND m.winner_id = c.id) AS toconf, (SELECT COUNT(*) FROM matches m WHERE m.status IN ('pending','disputed') AND (m.winner_id = c.id OR m.loser_id = c.id)) AS open FROM clan_members cm JOIN players p ON p.id = cm.player_id JOIN clans c ON c.id = cm.clan_id WHERE cm.role IN ('leader','coleader') AND (p.alias LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\') ORDER BY CASE cm.role WHEN 'leader' THEN 0 ELSE 1 END, toconf DESC, c.name COLLATE NOCASE LIMIT 200").all(like, like);
      sendJson(res, 200, { leaders: rows.map((r) => ({ playerId: r.pid, alias: r.alias, active: !!r.active, role: r.role, clanId: r.cid, clan: r.name, toConfirm: r.toconf, open: r.open })) });
      return true;
    }


    /* ===== Parte 4: sanciones, apelaciones, denuncias y reportes a líderes ===== */
    const nameOfTarget = (sa) => sa.target_type === 'clan' ? ((q.clanById.get(sa.clan_id) || {}).name || '?') : ((playerRow(sa.player_id) || {}).alias || '?');
    const byTarget = (type, id) => db.prepare('SELECT id, at, actor_alias, action, old_json, new_json, reason, result FROM audit_log WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT 40').all(type, id)
      .map((r) => ({ id: r.id, at: r.at, actor: r.actor_alias, action: r.action, old: r.old_json, new: r.new_json, reason: r.reason, result: r.result }));
    const evList = (type, id) => (can(me, 'evidence.view') ? st.evOf.all(type, id).map((e) => evView(e, true)) : []);

    // Deshace los efectos de una sanción (puntos devueltos, resultado restaurado).
    function undoEffects(sa) {
      if (sa.type === 'point_loss' && sa.adjust_id) {
        db.prepare('UPDATE ' + (sa.target_type === 'clan' ? 'clan_adjust' : 'player_adjust') + ' SET revoked_at = ? WHERE id = ? AND revoked_at = 0').run(Date.now(), sa.adjust_id);
        recompute();
      } else if (sa.type === 'result_annulment' && sa.match_id) {
        const m = st.matchRow.get(sa.match_id);
        if (m && m.status === 'annulled' && sa.prev_match_status) { db.prepare('UPDATE matches SET status = ?, rev = rev + 1 WHERE id = ?').run(sa.prev_match_status, m.id); recompute(); }
      }
    }
    const sanctionInfo = (sa) => ({ type: 'sanción', id: sa.id, player: sa.player_id, clan: sa.clan_id, match: sa.match_id });

    if (method === 'GET' && pathname === '/api/admin/reasons') {
      if (!need('sanctions.view')) return true;
      sendJson(res, 200, { reasons: db.prepare('SELECT code, label, active FROM sanction_reasons ORDER BY sort, label').all().map((r) => ({ code: r.code, label: r.label, active: !!r.active })), types: Object.keys(TYPE_LABEL).map((k) => ({ code: k, label: TYPE_LABEL[k], needsDuration: NEEDS_DURATION.includes(k), light: LIGHT_TYPES.includes(k), blocks: BLOCK_TYPES.includes(k), restricted: k === 'permanent_ban' && role !== 'superadmin' })), canApply: can(me, 'sanctions.apply'), canWarn: can(me, 'sanctions.warn'), appealDays: appealDays() });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/reasons') {
      if (!need('config.edit')) return true;
      const b = await readJson(req);
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const label = clean(b.label, 80);
      if (b.code) {
        const row = db.prepare('SELECT * FROM sanction_reasons WHERE code = ?').get(clean(b.code, 30));
        if (!row) { sendJson(res, 404, { error: 'Ese motivo no existe.' }); return true; }
        const active = b.active === true ? 1 : 0;
        if (row.active === active) { sendJson(res, 409, { error: 'No hay cambios que guardar.' }); return true; }
        tx(() => { db.prepare('UPDATE sanction_reasons SET active = ? WHERE code = ?').run(active, row.code); audit(me, 'motivo_sancion_' + (active ? 'activado' : 'desactivado'), { type: 'motivo', id: 0 }, { motivo: row.label, activo: !!row.active }, { activo: !!active }, reason, 'ok', req); });
      } else {
        if (label.length < 4) { sendJson(res, 400, { error: 'Escribe el nombre del motivo (al menos 4 caracteres).' }); return true; }
        const code = 'x' + crypto.randomBytes(4).toString('hex');
        tx(() => { db.prepare('INSERT INTO sanction_reasons (code, label, sort) VALUES (?,?,100)').run(code, label); audit(me, 'motivo_sancion_creado', { type: 'motivo', id: 0 }, null, { motivo: label }, reason, 'ok', req); });
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === 'GET' && pathname === '/api/admin/sanctions') {
      if (!need('sanctions.view')) return true;
      const now = Date.now(), where = ['1=1'], args = [];
      const stt = get('status');
      if (stt === 'active') { where.push(activeCond); args.push(now, now); } else if (['expired', 'revoked'].includes(stt)) { where.push('status = ?'); args.push(stt); } else if (stt === 'appeal') where.push("appeal_status = 'pending'");
      if (TYPE_LABEL[get('type')]) { where.push('type = ?'); args.push(get('type')); }
      const pid = int(get('player'), 1, 1e12), cid = int(get('clan'), 1, 1e12);
      if (pid) { where.push("target_type = 'player' AND player_id = ?"); args.push(pid); }
      if (cid) { where.push("target_type = 'clan' AND clan_id = ?"); args.push(cid); }
      const term = clean(get('q'), 40);
      if (term) { const like = '%' + esc(term) + '%'; where.push("((target_type = 'player' AND player_id IN (SELECT id FROM players WHERE alias LIKE ? ESCAPE '\\')) OR (target_type = 'clan' AND clan_id IN (SELECT id FROM clans WHERE name LIKE ? ESCAPE '\\')))"); args.push(like, like); }
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const total = db.prepare('SELECT COUNT(*) AS n FROM sanctions WHERE ' + where.join(' AND ')).get(...args).n;
      const rows = db.prepare('SELECT * FROM sanctions WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, sanctions: rows.map((sa) => Object.assign(sanctionLine(sa), { target: nameOfTarget(sa), reason: reasonLabel(sa.reason_code), activeNow: sa.status === 'active' && sa.starts_at <= now && (!sa.ends_at || sa.ends_at > now) })) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/admin/sanction') {
      if (!need('sanctions.view')) return true;
      const sa = db.prepare('SELECT * FROM sanctions WHERE id = ?').get(int(get('id'), 1, 1e12) || 0);
      if (!sa) { sendJson(res, 404, { error: 'Esa sanción no existe.' }); return true; }
      sendJson(res, 200, {
        sanction: Object.assign(sanctionLine(sa), { target: nameOfTarget(sa), reason: reasonLabel(sa.reason_code), description: sa.description, rules: sa.rules, complaintId: sa.complaint_id, appealText: sa.appeal_text, appealAt: sa.appeal_at, appealResolution: sa.appeal_resolution, byId: sa.by_id }),
        history: db.prepare('SELECT * FROM sanction_history WHERE sanction_id = ? ORDER BY id DESC').all(sa.id).map((h) => ({ at: h.at, actor: h.actor, action: h.action, old: h.old_json, new: h.new_json, reason: h.reason })),
        evidence: evList('sanction', sa.id), notes: notesFor('sanction', sa.id),
        canRevoke: can(me, 'sanctions.revoke') && (sa.type !== 'permanent_ban' || role === 'superadmin'), canEdit: can(me, 'sanctions.apply') && NEEDS_DURATION.includes(sa.type), canEvidence: can(me, 'sanctions.warn'), canResolve: can(me, 'appeals.resolve'), canNote: can(me, 'reports.review'),
      });
      return true;
    }

    if (method === 'POST' && pathname === '/api/admin/sanction/create') {
      const b = await readJson(req);
      const type = b.type;
      if (!TYPE_LABEL[type]) { sendJson(res, 400, { error: 'Tipo de sanción no válido.' }); return true; }
      if (type === 'permanent_ban') { if (role !== 'superadmin') { sendJson(res, 403, { error: 'El baneo permanente requiere autorización especial (superadministrador).' }); return true; } }
      else if (!need(LIGHT_TYPES.includes(type) ? 'sanctions.warn' : 'sanctions.apply')) return true;
      const targetType = b.targetType === 'clan' ? 'clan' : 'player';
      const tid = int(b.targetId, 1, 1e12) || 0;
      const fail = (st2, msg) => { sendJson(res, st2, { error: msg }); return true; };
      const target = targetType === 'clan' ? q.clanById.get(tid) : playerRow(tid);
      if (!target) return fail(404, 'No existe ese ' + (targetType === 'clan' ? 'clan.' : 'jugador.'));
      if (targetType === 'player' && (target.id === me.id || protectedTarget(target))) return fail(403, 'No puedes sancionar a esa persona.');
      const rs = db.prepare('SELECT * FROM sanction_reasons WHERE code = ? AND active = 1').get(clean(b.reasonCode, 30));
      if (!rs) return fail(400, 'Elige un motivo de la lista.');
      const description = clean(b.description, 1000);
      if (description.length < 10) return fail(400, 'Describe la infracción (al menos 10 caracteres).');
      const severity = SEVERITY.includes(b.severity) ? b.severity : 'leve';
      const rules = clean(b.rules, 300);
      const key = clean(b.key, 60);
      if (key.length < 8) return fail(400, 'Solicitud incompleta. Recarga la página.');
      if (type === 'permanent_ban' && b.confirmText !== 'BANEAR') return fail(400, 'Para el baneo permanente escribe BANEAR.');
      // Una acusación de trampas no es culpabilidad: hace falta una denuncia con infracción confirmada.
      let cmp = null;
      if (b.complaintId) { cmp = db.prepare('SELECT * FROM complaints WHERE id = ?').get(int(b.complaintId, 1, 1e12) || 0); if (!cmp) return fail(404, 'Esa denuncia no existe.'); }
      if (CHEAT_REASONS.includes(rs.code)) {
        if (!cmp || cmp.status !== 'confirmed') return fail(409, 'Una sanción por este motivo requiere una denuncia con la infracción confirmada tras revisar las evidencias.');
        if (targetType === 'player' && cmp.accused_id !== target.id) return fail(409, 'La denuncia vinculada es sobre otro jugador.');
      }
      if (cmp && cmp.sanction_id) return fail(409, 'Esa denuncia ya tiene una sanción aplicada.');
      let days = 0, endsAt = 0;
      if (NEEDS_DURATION.includes(type)) { days = int(b.days, 1, 365) || 0; if (!days) return fail(400, 'Indica la duración en días (1 a 365).'); }
      const now = Date.now();
      const startsAt = b.startsAt ? int(b.startsAt, now - 3600000, now + 90 * DAY) : now;
      if (!startsAt) return fail(400, 'La fecha de inicio debe estar entre ahora y 90 días.');
      if (days) endsAt = startsAt + days * DAY;
      let pts = 0;
      if (type === 'point_loss') { pts = int(b.points, 1, 20) || 0; if (!pts) return fail(400, 'Indica cuántas victorias quitar (1 a 20).'); }
      let mid = 0, prevMatch = '';
      if (type === 'result_annulment') {
        const m = st.matchRow.get(int(b.matchId, 1, 1e12) || 0);
        if (!m) return fail(404, 'Indica el partido cuyo resultado se anula.');
        const sea = q.seasonById.get(m.season_id);
        if (!sea || sea.status !== 'active') return fail(409, 'Ese partido es de una temporada cerrada.');
        if (!['pending', 'confirmed', 'disputed', 'rejected'].includes(m.status)) return fail(409, 'Ese partido no se puede anular en su estado actual.');
        if (targetType === 'clan' && m.winner_id !== target.id && m.loser_id !== target.id) return fail(409, 'Ese clan no participó en el partido.');
        mid = m.id; prevMatch = m.status;
      } else if (b.matchId) { const m = st.matchRow.get(int(b.matchId, 1, 1e12) || 0); if (!m) return fail(404, 'No existe ese partido.'); mid = m.id; }
      const appealable = b.appealable === false ? 0 : 1;
      let sid;
      try {
        sid = tx(() => {
          if (Number(st.idem.run('san:' + key, Date.now()).changes) !== 1) throw { dup: true };
          let adjustId = 0;
          if (type === 'point_loss') {
            const sea = q.activeSeason.get(); if (!sea) throw { msg: 'No hay una temporada activa.' };
            const cur = targetType === 'clan' ? target.wins : recOf(target.id).wins;
            if (cur < pts) throw { msg: 'Tiene menos victorias (' + cur + ') que las que se quieren quitar.' };
            const r = targetType === 'clan'
              ? db.prepare('INSERT INTO clan_adjust (clan_id, season_id, wins_delta, losses_delta, reason, by_alias, created_at) VALUES (?,?,?,?,?,?,?)').run(target.id, sea.id, -pts, 0, 'Sanción: ' + description.slice(0, 120), me.alias, now)
              : db.prepare('INSERT INTO player_adjust (player_id, season_id, wins_delta, losses_delta, reason, by_alias, created_at) VALUES (?,?,?,?,?,?,?)').run(target.id, sea.id, -pts, 0, 'Sanción: ' + description.slice(0, 120), me.alias, now);
            adjustId = Number(r.lastInsertRowid);
          }
          const r = db.prepare('INSERT INTO sanctions (target_type, player_id, clan_id, type, reason_code, description, severity, rules, match_id, complaint_id, starts_at, ends_at, appealable, pts, adjust_id, prev_match_status, by_id, by_alias, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(targetType, targetType === 'player' ? target.id : 0, targetType === 'clan' ? target.id : 0, type, rs.code, description, severity, rules, mid, cmp ? cmp.id : 0, startsAt, endsAt, appealable, pts, adjustId, prevMatch, me.id, me.alias, now, now);
          const id = Number(r.lastInsertRowid);
          if (type === 'result_annulment') db.prepare("UPDATE matches SET prev_status = status, status = 'annulled', rev = rev + 1 WHERE id = ?").run(mid);
          if (type === 'point_loss' || type === 'result_annulment') recompute();
          if (cmp) db.prepare('UPDATE complaints SET sanction_id = ?, updated_at = ? WHERE id = ?').run(id, now, cmp.id);
          shist(id, me.alias, 'creada', null, { tipo: type, motivo: rs.label, gravedad: severity, inicio: startsAt, fin: endsAt }, description.slice(0, 300));
          audit(me, 'sancion_aplicada', { type: 'sanción', id, player: targetType === 'player' ? target.id : 0, clan: targetType === 'clan' ? target.id : 0, match: mid }, null, { tipo: TYPE_LABEL[type], objetivo: target.alias || target.name, motivo: rs.label, gravedad: severity, dias: days, puntos: pts }, description.slice(0, 300), 'ok', req);
          return id;
        });
      } catch (e) {
        if (e && e.dup) return fail(409, 'Esta sanción ya se registró.');
        if (e && e.msg) return fail(400, e.msg);
        console.error(e); return fail(500, 'No se pudo aplicar la sanción.');
      }
      sendJson(res, 201, { ok: true, id: sid });
      return true;
    }

    if (method === 'POST' && (pathname === '/api/admin/sanction/revoke' || pathname === '/api/admin/sanction/edit' || pathname === '/api/admin/sanction/appeal')) {
      const b = await readJson(req);
      const sa = db.prepare('SELECT * FROM sanctions WHERE id = ?').get(parseInt(b.id, 10) || 0);
      const fail = (st2, msg) => { sendJson(res, st2, { error: msg }); return true; };
      if (!sa) return fail(404, 'Esa sanción no existe.');
      const op = pathname.split('/').pop();
      if (!need(op === 'revoke' ? 'sanctions.revoke' : op === 'edit' ? 'sanctions.apply' : 'appeals.resolve')) return true;
      if (sa.type === 'permanent_ban' && role !== 'superadmin') return fail(403, 'Solo un superadministrador puede modificar un baneo permanente.');
      const reason = needReason(b);
      if (!reason && op !== 'appeal') return fail(400, BAD_REASON);
      try {
        tx(() => {
          const now = Date.now();
          if (op === 'revoke') {
            if (sa.status !== 'active') throw { msg: 'Esa sanción ya no está vigente.' };
            const r = db.prepare("UPDATE sanctions SET status = 'revoked', updated_at = ? WHERE id = ? AND status = 'active'").run(now, sa.id);
            if (Number(r.changes) !== 1) throw { msg: 'Esa sanción ya no está vigente.' };
            undoEffects(sa);
            shist(sa.id, me.alias, 'revocada', { estado: 'active' }, { estado: 'revoked' }, reason);
            audit(me, 'sancion_revocada', sanctionInfo(sa), { estado: 'active' }, { estado: 'revoked' }, reason, 'ok', req);
          } else if (op === 'edit') {
            if (sa.status !== 'active') throw { msg: 'Solo se puede modificar una sanción vigente.' };
            const days = int(b.days, 1, 365); if (!days) throw { msg: 'Indica la nueva duración en días (1 a 365).' };
            const ends = sa.starts_at + days * DAY;
            if (ends <= now) throw { msg: 'Con esa duración la sanción ya habría terminado: usa «Levantar sanción».' };
            db.prepare('UPDATE sanctions SET ends_at = ?, updated_at = ? WHERE id = ?').run(ends, now, sa.id);
            shist(sa.id, me.alias, 'duracion_modificada', { fin: sa.ends_at }, { fin: ends }, reason);
            audit(me, 'sancion_modificada', sanctionInfo(sa), { fin: sa.ends_at }, { fin: ends }, reason, 'ok', req);
          } else {
            if (sa.appeal_status !== 'pending') throw { msg: 'Esta sanción no tiene una apelación pendiente.' };
            const decision = b.decision === 'accepted' ? 'accepted' : b.decision === 'rejected' ? 'rejected' : '';
            const resolution = clean(b.resolution, 1000);
            if (!decision) throw { msg: 'Elige aceptar o rechazar la apelación.' };
            if (resolution.length < 10) throw { msg: 'Escribe la resolución de la apelación (al menos 10 caracteres).' };
            db.prepare('UPDATE sanctions SET appeal_status = ?, appeal_resolution = ?, updated_at = ? WHERE id = ?').run(decision, resolution, now, sa.id);
            if (decision === 'accepted' && sa.status === 'active') { db.prepare("UPDATE sanctions SET status = 'revoked' WHERE id = ?").run(sa.id); undoEffects(sa); }
            shist(sa.id, me.alias, 'apelacion_' + decision, { apelacion: 'pending' }, { apelacion: decision }, resolution);
            audit(me, 'apelacion_resuelta', sanctionInfo(sa), { apelacion: 'pending' }, { apelacion: decision }, resolution.slice(0, 300), 'ok', req);
          }
        });
      } catch (e) { if (e && e.msg) return fail(409, e.msg); console.error(e); return fail(500, 'No se pudo completar la acción.'); }
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Denuncias (antitrampas) ----- */
    if (method === 'GET' && pathname === '/api/admin/complaints') {
      if (!need('complaints.manage')) return true;
      const where = ['1=1'], args = [];
      if (COMPLAINT_STATUS.includes(get('status'))) { where.push('c.status = ?'); args.push(get('status')); } else if (get('status') === 'open') where.push("c.status IN ('received','pending','investigating')");
      const term = clean(get('q'), 40);
      if (term) { const like = '%' + esc(term) + '%'; where.push("(pa.alias LIKE ? ESCAPE '\\' OR pc.alias LIKE ? ESCAPE '\\')"); args.push(like, like); }
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const base = ' FROM complaints c JOIN players pa ON pa.id = c.accused_id LEFT JOIN players pc ON pc.id = c.accuser_id WHERE ' + where.join(' AND ');
      const total = db.prepare('SELECT COUNT(*) AS n' + base).get(...args).n;
      const rows = db.prepare('SELECT c.*, pa.alias AS accused, pc.alias AS accuser' + base + ' ORDER BY c.id DESC LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, complaints: rows.map((c) => ({ id: c.id, status: c.status, accused: c.accused, accusedId: c.accused_id, accuser: c.accuser || 'Administración', matchId: c.match_id, createdAt: c.created_at, sanctionId: c.sanction_id })) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/admin/complaint') {
      if (!need('complaints.manage')) return true;
      const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(int(get('id'), 1, 1e12) || 0);
      if (!c) { sendJson(res, 404, { error: 'Esa denuncia no existe.' }); return true; }
      const ac = playerById(c.accused_id), ar = c.accuser_id ? playerById(c.accuser_id) : null;
      sendJson(res, 200, {
        complaint: { id: c.id, status: c.status, accusedId: c.accused_id, accused: ac ? ac.alias : '?', accuserId: c.accuser_id, accuser: ar ? ar.alias : 'Administración', matchId: c.match_id, incidentAt: c.incident_at, serverIp: c.server_ip || '', description: c.description, resolution: c.resolution, sanctionId: c.sanction_id, createdAt: c.created_at, updatedAt: c.updated_at },
        evidence: evList('complaint', c.id), notes: notesFor('complaint', c.id), history: byTarget('denuncia', c.id),
        canResolve: can(me, 'sanctions.apply'), canSanction: can(me, 'sanctions.apply'),
      });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/complaint/create') {
      if (!need('complaints.manage')) return true;
      const b = await readJson(req);
      const accused = (parseInt(b.accusedId, 10) > 0 ? playerById(parseInt(b.accusedId, 10)) : null) || (clean(b.accusedAlias, 40) ? st.playerByAlias.get(clean(b.accusedAlias, 40)) : null);
      const description = clean(b.description, 2000), key = clean(b.key, 60);
      if (!accused) { sendJson(res, 404, { error: 'No existe un jugador con ese nombre o ID.' }); return true; }
      if (description.length < 20) { sendJson(res, 400, { error: 'Describe lo ocurrido con al menos 20 caracteres.' }); return true; }
      if (key.length < 8) { sendJson(res, 400, { error: 'Solicitud incompleta. Recarga la página.' }); return true; }
      const accuser = clean(b.accuserAlias, 40) ? st.playerByAlias.get(clean(b.accuserAlias, 40)) : null;
      if (clean(b.accuserAlias, 40) && !accuser) { sendJson(res, 404, { error: 'No existe el denunciante indicado.' }); return true; }
      const mid = b.matchId ? int(b.matchId, 1, 1e12) : 0;
      if (b.matchId && (!mid || !st.matchRow.get(mid))) { sendJson(res, 404, { error: 'No existe ese partido.' }); return true; }
      const sip2 = srvIp(b.serverIp); if (sip2 === null) { sendJson(res, 400, { error: 'La IP del servidor no es válida (ej. 200.1.2.3:12203).' }); return true; }
      const when = b.incidentAt ? int(b.incidentAt, 1, Date.now() + 3600000) : 0;
      let id;
      try {
        id = tx(() => {
          if (Number(st.idem.run('cmp:' + key, Date.now()).changes) !== 1) throw { dup: true };
          const now = Date.now();
          const r = db.prepare("INSERT INTO complaints (accuser_id, accused_id, match_id, incident_at, server_ip, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'pending',?,?)").run(accuser ? accuser.id : 0, accused.id, mid, when || 0, sip2, description, now, now);
          audit(me, 'denuncia_registrada', { type: 'denuncia', id: Number(r.lastInsertRowid), player: accused.id, match: mid }, null, { denunciado: accused.alias }, '', 'ok', req);
          return Number(r.lastInsertRowid);
        });
      } catch (e) { if (e && e.dup) { sendJson(res, 409, { error: 'Esta denuncia ya se registró.' }); return true; } console.error(e); sendJson(res, 500, { error: 'No se pudo registrar.' }); return true; }
      sendJson(res, 201, { ok: true, id });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/complaint/update') {
      if (!need('complaints.manage')) return true;
      const b = await readJson(req);
      const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(parseInt(b.id, 10) || 0);
      if (!c) { sendJson(res, 404, { error: 'Esa denuncia no existe.' }); return true; }
      if (!COMPLAINT_STATUS.includes(b.status)) { sendJson(res, 400, { error: 'Estado no válido.' }); return true; }
      if (COMPLAINT_FINAL.includes(b.status) && !need('sanctions.apply')) return true;
      const reason = needReason(b);
      if (!reason) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const resolution = clean(b.resolution, 1000);
      if (['insufficient', 'confirmed', 'rejected', 'closed'].includes(b.status) && resolution.length < 10) { sendJson(res, 400, { error: 'Escribe la resolución (al menos 10 caracteres).' }); return true; }
      if (c.status === b.status && !resolution) { sendJson(res, 409, { error: 'No hay cambios que guardar.' }); return true; }
      if (b.status === 'closed' && c.status === 'confirmed' && !c.sanction_id && b.confirmNoSanction !== true) { sendJson(res, 409, { error: 'La infracción está confirmada y no hay sanción aplicada. Aplica una sanción o confirma que se cierra sin sanción.' }); return true; }
      tx(() => {
        db.prepare('UPDATE complaints SET status = ?, resolution = CASE WHEN ? <> \'\' THEN ? ELSE resolution END, updated_at = ? WHERE id = ?').run(b.status, resolution, resolution, Date.now(), c.id);
        audit(me, 'denuncia_' + b.status, { type: 'denuncia', id: c.id, player: c.accused_id, match: c.match_id }, { estado: c.status }, { estado: b.status, resolucion: resolution.slice(0, 200) }, reason, 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Reportes disciplinarios a líderes ----- */
    if (method === 'GET' && pathname === '/api/admin/discs') {
      if (!need('disc.view')) return true;
      const where = ['1=1'], args = [];
      if (DISC_STATUS.includes(get('status'))) { where.push('d.status = ?'); args.push(get('status')); } else if (get('status') === 'open') where.push("d.status IN ('pending','notified','review')");
      const cid = int(get('clan'), 1, 1e12); if (cid) { where.push('d.clan_id = ?'); args.push(cid); }
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 20;
      const base = ' FROM disc_reports d JOIN clans c ON c.id = d.clan_id JOIN players p ON p.id = d.leader_id WHERE ' + where.join(' AND ');
      const total = db.prepare('SELECT COUNT(*) AS n' + base).get(...args).n;
      const rows = db.prepare('SELECT d.*, c.name AS cname, p.alias AS lalias' + base + ' ORDER BY d.id DESC LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, discs: rows.map((d) => ({ id: d.id, clan: d.cname, clanId: d.clan_id, leader: d.lalias, leaderId: d.leader_id, reason: d.reason, severity: d.severity, status: d.status, deadlineAt: d.deadline_at, createdAt: d.created_at, responded: !!d.responded_at, overdue: d.deadline_at > 0 && Date.now() > d.deadline_at && !d.responded_at && ['notified', 'pending'].includes(d.status) })) });
      return true;
    }
    if (method === 'GET' && pathname === '/api/admin/disc') {
      if (!need('disc.view')) return true;
      const d = db.prepare('SELECT * FROM disc_reports WHERE id = ?').get(int(get('id'), 1, 1e12) || 0);
      if (!d) { sendJson(res, 404, { error: 'Ese reporte no existe.' }); return true; }
      sendJson(res, 200, {
        disc: { id: d.id, clanId: d.clan_id, clan: (q.clanById.get(d.clan_id) || {}).name, leaderId: d.leader_id, leader: (playerById(d.leader_id) || {}).alias, matchId: d.match_id, reason: d.reason, description: d.description, incidentAt: d.incident_at, severity: d.severity, deadlineAt: d.deadline_at, status: d.status, resolution: d.resolution, measures: d.measures, response: d.leader_response, respondedAt: d.responded_at, notifiedAt: d.notified_at, by: d.by_alias, createdAt: d.created_at },
        evidence: evList('disc', d.id), notes: notesFor('disc', d.id), history: byTarget('reporte disciplinario', d.id), canManage: can(me, 'disc.manage'), canEvidence: can(me, 'disc.manage'), canNote: can(me, 'reports.review'),
      });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/disc/create') {
      if (!need('disc.manage')) return true;
      const b = await readJson(req);
      const fail = (st2, msg) => { sendJson(res, st2, { error: msg }); return true; };
      const clan = q.clanById.get(int(b.clanId, 1, 1e12) || 0);
      if (!clan) return fail(404, 'Elige el clan involucrado.');
      const lm = db.prepare("SELECT player_id, role FROM clan_members WHERE clan_id = ? AND player_id = ? AND role IN ('leader','coleader')").get(clan.id, int(b.leaderId, 1, 1e12) || 0);
      if (!lm) return fail(400, 'Elige al Líder o Colíder responsable de ese clan.');
      const reason = clean(b.reason, 200), description = clean(b.description, 1500), key = clean(b.key, 60);
      if (reason.length < 5) return fail(400, 'Indica el motivo del incumplimiento (al menos 5 caracteres).');
      if (description.length < 10) return fail(400, 'Agrega una descripción (al menos 10 caracteres).');
      if (key.length < 8) return fail(400, 'Solicitud incompleta. Recarga la página.');
      const mid = b.matchId ? int(b.matchId, 1, 1e12) : 0;
      if (b.matchId) { const m = mid ? st.matchRow.get(mid) : null; if (!m || (m.winner_id !== clan.id && m.loser_id !== clan.id)) return fail(400, 'Ese partido no existe o no involucra a ese clan.'); }
      const sev = SEVERITY.includes(b.severity) ? b.severity : 'leve';
      const days = int(b.deadlineDays, 1, 30) || 7;
      const inc = b.incidentAt ? int(b.incidentAt, 1, Date.now() + 3600000) : 0;
      if (b.incidentAt && !inc) return fail(400, 'La fecha del incidente no es válida.');
      let id;
      try {
        id = tx(() => {
          if (Number(st.idem.run('disc:' + key, Date.now()).changes) !== 1) throw { dup: true };
          const now = Date.now();
          const r = db.prepare("INSERT INTO disc_reports (clan_id, leader_id, match_id, reason, description, incident_at, severity, deadline_at, status, by_alias, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)").run(clan.id, lm.player_id, mid, reason, description, inc, sev, now + days * DAY, me.alias, now, now);
          const did = Number(r.lastInsertRowid);
          audit(me, 'reporte_disciplinario_creado', { type: 'reporte disciplinario', id: did, clan: clan.id, player: lm.player_id, match: mid }, null, { motivo: reason, gravedad: sev, plazoDias: days }, '', 'ok', req);
          return did;
        });
      } catch (e) { if (e && e.dup) return fail(409, 'Este reporte ya se creó.'); console.error(e); return fail(500, 'No se pudo crear el reporte.'); }
      sendJson(res, 201, { ok: true, id });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/disc/update') {
      if (!need('disc.manage')) return true;
      const b = await readJson(req);
      const d = db.prepare('SELECT * FROM disc_reports WHERE id = ?').get(parseInt(b.id, 10) || 0);
      const fail = (st2, msg) => { sendJson(res, st2, { error: msg }); return true; };
      if (!d) return fail(404, 'Ese reporte no existe.');
      const reason = needReason(b); if (!reason) return fail(400, BAD_REASON);
      const a = b.action, resolution = clean(b.resolution, 1500), measures = clean(b.measures, 500);
      let next = '';
      if (a === 'notify') { if (d.status !== 'pending') return fail(409, 'Solo se notifica un reporte pendiente.'); next = 'notified'; }
      else if (a === 'review') { if (!['pending', 'notified'].includes(d.status)) return fail(409, 'Ese reporte no se puede poner en revisión.'); next = 'review'; }
      else if (a === 'resolve') { if (['resolved', 'closed'].includes(d.status)) return fail(409, 'Ese reporte ya fue resuelto.'); if (resolution.length < 10) return fail(400, 'Escribe la resolución (al menos 10 caracteres).'); next = 'resolved'; }
      else if (a === 'close') { if (d.status !== 'resolved') return fail(409, 'Primero resuelve el reporte.'); next = 'closed'; }
      else return fail(400, 'Acción no válida.');
      tx(() => {
        const now = Date.now();
        db.prepare('UPDATE disc_reports SET status = ?, notified_at = CASE WHEN ? = \'notified\' THEN ? ELSE notified_at END, resolution = CASE WHEN ? = \'resolved\' THEN ? ELSE resolution END, measures = CASE WHEN ? = \'resolved\' THEN ? ELSE measures END, updated_at = ? WHERE id = ?').run(next, next, now, next, resolution, next, measures, now, d.id);
        audit(me, 'reporte_disciplinario_' + next, { type: 'reporte disciplinario', id: d.id, clan: d.clan_id, player: d.leader_id, match: d.match_id }, { estado: d.status }, { estado: next, resolucion: resolution.slice(0, 200), medidas: measures }, reason, 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    /* ----- Historial de auditoría (solo lectura) ----- */
    if (method === 'GET' && pathname === '/api/admin/audit') {
      if (!need('audit.view')) return true;
      const where = ['1=1'], args = [];
      const actor = clean(get('actor'), 40); if (actor) { where.push("actor_alias LIKE ? ESCAPE '\\'"); args.push('%' + actor.replace(/[\\%_]/g, (c) => '\\' + c) + '%'); }
      const action = clean(get('action'), 60); if (action) { where.push('action LIKE ?'); args.push(action.replace(/[%_]/g, '') + '%'); }
      for (const [k, col] of [['player', 'player_id'], ['clan', 'clan_id'], ['match', 'match_id']]) { const v = int(get(k), 1, 1e12); if (v) { where.push(col + ' = ?'); args.push(v); } }
      const from = int(get('from'), 1, 4e12), to = int(get('to'), 1, 4e12);
      if (from) { where.push('at >= ?'); args.push(from); }
      if (to) { where.push('at <= ?'); args.push(to); }
      const page = Math.max(1, Math.min(100000, parseInt(get('page'), 10) || 1)), per = 25;
      const total = db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE ' + where.join(' AND ')).get(...args).n;
      const rows = db.prepare('SELECT * FROM audit_log WHERE ' + where.join(' AND ') + ' ORDER BY id DESC LIMIT ? OFFSET ?').all(...args, per, (page - 1) * per);
      sendJson(res, 200, { total, page, per, rows: rows.map((r) => ({ id: r.id, at: r.at, actor: r.actor_alias, role: r.actor_role, action: r.action, type: r.target_type, targetId: r.target_id, playerId: r.player_id, clanId: r.clan_id, matchId: r.match_id, old: r.old_json, new: r.new_json, reason: r.reason, result: r.result })) });
      return true;
    }

    /* ----- Personal con permisos (solo superadministrador) ----- */
    if (method === 'GET' && pathname === '/api/admin/staff') {
      if (!need('roles.manage')) return true;
      const list = st.staff.all().map((r) => ({ id: r.id, alias: r.alias, role: r.admin_role, locked: false }));
      for (const a of ADMINS) { const p = st.playerByAlias.get(a); if (p && !list.some((x) => x.id === p.id)) list.push({ id: p.id, alias: p.alias, role: 'superadmin', locked: true }); else if (p) { const x = list.find((y) => y.id === p.id); x.role = 'superadmin'; x.locked = true; } }
      sendJson(res, 200, { staff: list });
      return true;
    }
    if (method === 'POST' && pathname === '/api/admin/staff/set') {
      if (!need('roles.manage')) return true;
      const b = await readJson(req);
      const reason = reasonOf(b);
      if (reason.length < 5) { sendJson(res, 400, { error: BAD_REASON }); return true; }
      const target = st.playerByAlias.get(clean(b.alias, 40));
      if (!target) { sendJson(res, 404, { error: 'No existe un jugador con ese nombre.' }); return true; }
      const nr = b.role === '' ? '' : (ROLES.includes(b.role) ? b.role : null);
      if (nr === null) { sendJson(res, 400, { error: 'Rol no válido.' }); return true; }
      if (target.id === me.id) { sendJson(res, 409, { error: 'No puedes cambiar tu propio rol.' }); return true; }
      if (ADMINS.has(String(target.alias).toLowerCase())) { sendJson(res, 409, { error: 'Ese usuario es superadministrador por configuración del servidor.' }); return true; }
      if (b.confirm !== true) { sendJson(res, 400, { error: 'Falta la confirmación.' }); return true; }
      if (target.admin_role === nr) { sendJson(res, 409, { error: 'Ya tiene ese rol.' }); return true; }
      tx(() => {
        st.setRole.run(nr, target.id);
        audit(me, 'rol_cambiado', { type: 'jugador', id: target.id, player: target.id }, { rol: target.admin_role }, { rol: nr }, reason, 'ok', req);
      });
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: 'No encontrado.' });
    return true;
  }

  return { handle, roleOf, can, recompute, playerRecord, audit, tx, competeBlock, clanBlocked, expireSanctions };
}

module.exports = { migrate, init, ROLES };
