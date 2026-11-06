/* Datos de PRUEBA para probar el sitio sin esperar a gente real.
 *
 *   node sembrar-prueba.js            crea jugadores, clanes y partidos de prueba
 *   node sembrar-prueba.js --borrar   borra solo los datos de prueba
 *
 * Usa la misma carpeta de datos que el servidor (DATA_DIR o ./data). Si la base todavía no existe,
 * arranca el servidor una vez (node server.js), ciérralo y vuelve a ejecutar esto.
 * Todos los jugadores de prueba tienen la contraseña: prueba1234
 * Los jugadores se llaman prueba_<clan>_<n>, los clanes "Prueba <Nombre>" con tag PRU.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const file = path.join(DATA_DIR, 'ladder.db');
if (!fs.existsSync(file)) { console.error('No existe ' + file + '. Arranca el servidor una vez (node server.js), ciérralo y repite.'); process.exit(1); }
const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = ON');

if (process.argv.includes('--borrar')) {
  const c = db.prepare("DELETE FROM clans WHERE name LIKE 'Prueba %'").run().changes;
  const p = db.prepare("DELETE FROM players WHERE alias LIKE 'prueba\\_%' ESCAPE '\\'").run().changes;
  db.prepare("DELETE FROM seasons WHERE origin = 'prueba'").run();
  console.log('Borrados: ' + p + ' jugadores y ' + c + ' clanes de prueba (y sus partidos).');
  process.exit(0);
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const salt = crypto.randomBytes(16);
const key = crypto.scryptSync('prueba1234'.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
const hash = ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');

const clans = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Eco', 'Fox', 'Golf', 'Hotel'];
if (db.prepare("SELECT 1 FROM players WHERE alias LIKE 'prueba\\_%' ESCAPE '\\'").get()) { console.error('Ya hay datos de prueba. Usa --borrar primero.'); process.exit(1); }

const now = Date.now(), DAY = 86400000;
const insP = db.prepare("INSERT INTO players (alias, email, pass_hash, icq, aim, msn, website, logo, created_at, verified) VALUES (?,?,?,?,?,?,?,?,?,1)");
const insC = db.prepare("INSERT INTO clans (name, tag, website, logo, created_at) VALUES (?,?,?,?,?)");
const insM = db.prepare("INSERT INTO clan_members (clan_id, player_id, role, joined_at) VALUES (?,?,?,?)");
const insMatch = db.prepare("INSERT INTO matches (winner_id, loser_id, reporter_id, status, created_at, resolved_at, report_comment, confirm_comment, confirmer_id, loss_applied, season_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
const insMP = db.prepare('INSERT INTO match_players (match_id, player_id, side) VALUES (?,?,?)');
const addWin = db.prepare('UPDATE clans SET wins = wins + 1, streak = CASE WHEN streak > 0 THEN streak + 1 ELSE 1 END, last_match = ? WHERE id = ?');
const addLoss = db.prepare('UPDATE clans SET losses = losses + 1, streak = CASE WHEN streak < 0 THEN streak - 1 ELSE -1 END, last_match = ? WHERE id = ?');

const info = []; // { clan, players: [ids] }
db.exec('BEGIN');
// Temporadas: una activa para jugar (si no hay ya una) y una anterior ya cerrada con sus copas.
let sea = db.prepare("SELECT id FROM seasons WHERE status = 'active'").get();
const oldId = Number(db.prepare("INSERT INTO seasons (name, stage, starts_at, ends_at, status, closed_at, closed_by, origin) VALUES ('Objetivo 2026', 'Etapa I', ?, ?, 'closed', ?, 'prueba_admin', 'prueba')").run(now - 120 * DAY, now - 45 * DAY, now - 45 * DAY).lastInsertRowid);
const seaId = sea ? sea.id : Number(db.prepare("INSERT INTO seasons (name, stage, starts_at, ends_at, origin) VALUES ('Objetivo 2026', 'Etapa II', ?, 0, 'prueba')").run(now - 40 * DAY).lastInsertRowid);
clans.forEach((name, i) => {
  const slug = name.toLowerCase();
  const ids = [];
  for (let n = 1; n <= 3; n++) {
    const alias = 'prueba_' + slug + '_' + n;
    ids.push(Number(insP.run(alias, alias + '@prueba.invalid', hash, '', '', '', '', '', now - (30 - i) * DAY).lastInsertRowid));
  }
  const cid = Number(insC.run('Prueba ' + name, 'PRU', '', '', now - (30 - i) * DAY).lastInsertRowid);
  ids.forEach((pid, k) => insM.run(cid, pid, k === 0 ? 'leader' : 'member', now - (30 - i) * DAY));
  info.push({ id: cid, players: ids });
});

// Partidos confirmados (ganador, perdedor), del más viejo al más nuevo.
const games = [[0, 1], [0, 2], [3, 1], [3, 0], [4, 5], [2, 5], [6, 7], [0, 7], [4, 3], [6, 1], [2, 7], [5, 7], ...Array(9).fill([0, 7])];  // Alfa gana 10 seguidas (HOT) y Hotel acumula derrotas (COLD)
games.forEach(([w, l], k) => {
  const W = info[w], L = info[l], t = now - (games.length - k) * 3 * 3600 * 1000;
  const mid = Number(insMatch.run(W.id, L.id, L.players[0], 'confirmed', t, t + 600000, 'gg, buen partido', 'gg wp', W.players[0], 1, seaId).lastInsertRowid);
  L.players.slice(0, 2 + (k % 2)).forEach((p) => insMP.run(mid, p, 'loser'));
  W.players.slice(0, 2 + ((k + 1) % 2)).forEach((p) => insMP.run(mid, p, 'winner'));
  addWin.run(t + 600000, W.id); addLoss.run(t + 600000, L.id);
});
// Un reporte pendiente: Eco reportó que perdió contra Alfa (ya cuenta como derrota de Eco).
{
  const W = info[0], L = info[4], t = now - 1800000;
  const mid = Number(insMatch.run(W.id, L.id, L.players[0], 'pending', t, 0, 'jugamos en Remagen', '', 0, 1, seaId).lastInsertRowid);
  insMP.run(mid, L.players[0], 'loser'); insMP.run(mid, L.players[1], 'loser');
  addLoss.run(t, L.id);
}
// Invitación pendiente de ejemplo: un jugador sin clan.
const free = Number(insP.run('prueba_libre_1', 'prueba_libre_1@prueba.invalid', hash, '', '', '', '', '', now - 2 * DAY).lastInsertRowid);
db.prepare('INSERT INTO clan_invites (clan_id, player_id, created_at) VALUES (?,?,?)').run(info[1].id, free, now - 3600000);
// Temporada anterior ya cerrada: tabla final con sus copas (oro, plata y bronce para los tres primeros).
[[1, 'Charlie', 30, 4, 7], [2, 'Alfa', 27, 6, 5], [3, 'Golf', 21, 9, 3], [4, 'Delta', 14, 12, 2], [5, 'Bravo', 8, 15, -3]].forEach(([r, n, w, l, st], i) => {
  const c = info[clans.indexOf(n)];
  db.prepare('INSERT INTO season_results (season_id, rank, clan_id, clan_name, wins, losses, streak) VALUES (?,?,?,?,?,?,?)').run(oldId, r, c.id, 'Prueba ' + n, w, l, st);
});
insP.run('prueba_admin', 'prueba_admin@prueba.invalid', hash, '', '', '', '', '', now - 60 * DAY);
db.exec('COMMIT');

console.log('Listo: ' + (clans.length * 3 + 1) + ' jugadores, ' + clans.length + ' clanes, ' + games.length + ' partidos confirmados y 1 reporte pendiente.');
console.log('Contraseña de todos: prueba1234');
console.log('Líderes: ' + clans.map((c) => 'prueba_' + c.toLowerCase() + '_1').join(', '));
console.log('Administrador de prueba: prueba_admin (arranca el servidor con ADMIN_ALIAS=prueba_admin para verlo como administrador).');
console.log('Para probar: entra como prueba_alfa_1 → «Confirmar victoria» (hay un reporte de Eco pendiente).');
console.log('Para borrar todo esto: node sembrar-prueba.js --borrar');
