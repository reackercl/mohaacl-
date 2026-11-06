/* Panel «Administración Ladder» (parte 1: resumen, partidos, historial, configuración). */
(function () {
  var root = document.getElementById("view-panel");
  if (!root) return;
  var info = null;            // { alias, role, roleLabel, perms }
  var section = "resumen";
  var mf = { q: "", status: "", mode: "", from: "", to: "", page: 1 };
  var af = { actor: "", action: "", player: "", clan: "", match: "", from: "", to: "", page: 1 };
  var busy = false;
  var rf = { view: "queue", q: "", page: 1 };
  var lastSection = "partidos";
  var pf = { q: "", status: "", page: 1 }, cf = { q: "", page: 1 }, lf = { q: "" };
  var curP = null, curC = null;
  var FLAG = { duplicate: "Duplicado", invalid: "Inválido", needs_info: "Falta información" };

  var STATUS = { pending: "Reportado (pendiente)", disputed: "En disputa", confirmed: "Validado", rejected: "Rechazado", annulled: "Anulado", cancelled: "Cancelado", deleted: "Eliminado" };
  var ACTIONS = {
    partido_creado: "Partido creado", partido_modificado: "Partido modificado", partido_estado_confirmed: "Partido validado",
    partido_estado_pending: "Partido vuelto a pendiente", partido_estado_disputed: "Partido en disputa", partido_estado_rejected: "Partido rechazado",
    partido_estado_annulled: "Partido anulado", partido_eliminado_logico: "Partido eliminado (lógico)", partido_restaurado: "Partido restaurado",
    partido_eliminado_definitivo: "Partido eliminado definitivamente", rol_cambiado: "Rol cambiado", acceso_denegado: "Acceso denegado",
    reporte_marcado_duplicate: "Reporte marcado duplicado", reporte_marcado_invalid: "Reporte marcado inválido", reporte_marcado_needs_info: "Se pidió más información",
    reporte_marcado_clear: "Marca del reporte quitada", disputa_abierta: "Disputa abierta", nota_privada: "Nota privada", resolucion_publicada: "Resolución publicada",
    evidencia_agregada: "Evidencia agregada", evidencia_ocultada: "Evidencia ocultada", evidencia_restaurada: "Evidencia restaurada", config_cambiada: "Configuración cambiada",
    jugador_renombrado: "Nick cambiado", cuenta_activada: "Cuenta activada", cuenta_desactivada: "Cuenta desactivada", clan_cambiado: "Clan del jugador cambiado", rol_clan_cambiado: "Rol en el clan cambiado",
    ajuste_estadisticas_jugador: "Ajuste de estadísticas (jugador)", ajuste_estadisticas_clan: "Ajuste de estadísticas (clan)", ajuste_jugador_revertido: "Ajuste de jugador revertido", ajuste_clan_revertido: "Ajuste de clan revertido",
    clan_modificado: "Clan modificado", lider_principal_cambiado: "Líder principal cambiado", colider_designado: "Colíder designado", colider_revocado: "Colíder revocado",
    sancion_aplicada: "Sanción aplicada", sancion_revocada: "Sanción revocada", sancion_modificada: "Sanción modificada", sancion_expirada: "Sanción expirada", apelacion_presentada: "Apelación presentada", apelacion_resuelta: "Apelación resuelta",
    denuncia_registrada: "Denuncia registrada", denuncia_received: "Denuncia recibida", denuncia_pending: "Denuncia pendiente", denuncia_investigating: "Denuncia en investigación", denuncia_insufficient: "Denuncia: evidencia insuficiente", denuncia_confirmed: "Denuncia confirmada", denuncia_rejected: "Denuncia rechazada", denuncia_closed: "Denuncia cerrada",
    reporte_disciplinario_creado: "Reporte disciplinario creado", reporte_disciplinario_notified: "Líder notificado", reporte_disciplinario_review: "Reporte en revisión", reporte_disciplinario_resolved: "Reporte resuelto", reporte_disciplinario_closed: "Reporte cerrado", reporte_disciplinario_respondido: "Líder respondió el reporte",
    respaldo_creado: "Respaldo creado", respaldo_descargado: "Respaldo descargado", link_agregado: "Link agregado", link_modificado: "Link modificado", link_eliminado: "Link eliminado", descarga_agregada: "Descarga agregada", descarga_modificada: "Descarga modificada", descarga_eliminada: "Descarga eliminada", noticia_publicada: "Noticia publicada", noticia_modificada: "Noticia modificada", noticia_eliminada: "Noticia eliminada", servidores_actualizados: "Lista de servidores actualizada", motivo_sancion_creado: "Motivo de sanción creado", motivo_sancion_activado: "Motivo de sanción activado", motivo_sancion_desactivado: "Motivo de sanción desactivado"
  };
  var SSTATUS = { active: "Vigente", expired: "Expirada", revoked: "Revocada" };
  var CSTATUS = { received: "Recibida", pending: "Pendiente", investigating: "En investigación", insufficient: "Evidencia insuficiente", confirmed: "Infracción confirmada", rejected: "Rechazada", closed: "Cerrada" };
  var DSTATUS = { pending: "Pendiente", notified: "Líder notificado", review: "En revisión", resolved: "Resuelto", closed: "Cerrado" };
  var SEV = { leve: "Leve", moderada: "Moderada", grave: "Grave" };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fdt(ms) { return ms ? new Date(ms).toLocaleString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"; }
  function toLocalInput(ms) { if (!ms) return ""; var d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); }
  function fromLocalInput(v) { return v ? new Date(v).getTime() : 0; }
  function dayStart(v) { return v ? new Date(v + "T00:00:00").getTime() : ""; }
  function dayEnd(v) { return v ? new Date(v + "T23:59:59").getTime() : ""; }
  function getJson(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  }
  function post(url, data) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(data || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); });
  }
  function can(p) { return !!info && (info.perms.indexOf("*") >= 0 || info.perms.indexOf(p) >= 0); }
  function newKey() { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function badge(s) { return '<span class="badge st-' + esc(s) + '">' + esc(STATUS[s] || s) + "</span>"; }
  function pager(page, total, per, attr) {
    var pages = Math.ceil(total / per);
    if (pages <= 1) return "";
    return '<div class="pn-pager"><button type="button" class="linkbtn" data-' + attr + '="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + '>« Anterior</button> Página ' + page + " de " + pages +
      ' <button type="button" class="linkbtn" data-' + attr + '="' + (page + 1) + '"' + (page >= pages ? " disabled" : "") + ">Siguiente »</button></div>";
  }

  // Ventana de confirmación; con { input } pide además escribir un texto.
  function dialog(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var back = document.createElement("div"); back.className = "modal-back";
      var box = document.createElement("div"); box.className = "modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      var p = document.createElement("p"); p.textContent = message; box.appendChild(p);
      var inp = null;
      if (opts.input) { inp = document.createElement("input"); inp.type = "text"; inp.className = "pn-dlg-input"; inp.placeholder = opts.input; inp.autocomplete = "off"; box.appendChild(inp); }
      var row = document.createElement("div"); row.className = "row";
      var ok = document.createElement("button"); ok.type = "button"; ok.textContent = opts.ok || "Aceptar";
      var no = document.createElement("button"); no.type = "button"; no.textContent = "Cancelar";
      row.appendChild(ok); row.appendChild(no); box.appendChild(row); back.appendChild(box);
      function done(v) { document.removeEventListener("keydown", key); back.remove(); resolve(v); }
      function key(e) { if (e.key === "Escape") done(null); }
      ok.addEventListener("click", function () { done(inp ? inp.value.trim() : true); });
      no.addEventListener("click", function () { done(null); });
      back.addEventListener("click", function (e) { if (e.target === back) done(null); });
      document.addEventListener("keydown", key);
      document.body.appendChild(back);
      (inp || ok).focus();
    });
  }

  var NAV = [
    ["resumen", "Resumen", true], ["partidos", "Gestión de partidos", true], ["reportes", "Gestión de reportes", true],
    ["jugadores", "Gestión de jugadores", true], ["clanes", "Gestión de clanes", true], ["sanciones", "Sanciones y disciplina", true],
    ["lideres", "Gestión de líderes de clan", true], ["historial", "Historial de acciones", true], ["config", "Configuración de la Ladder", true]
  ];

  function shell() {
    var items = NAV.map(function (n) {
      if (!n[2]) return '<li class="soon"><span>' + esc(n[1]) + '</span><em>pronto</em></li>';
      return '<li><a href="#panel/' + n[0] + '" data-sec="' + n[0] + '"' + (section === n[0] || (section === "partido" && n[0] === lastSection) || (section === "jugador" && n[0] === "jugadores") || (section === "clan" && n[0] === "clanes") || ((section === "sancion" || section === "sancion-nueva" || section === "denuncia") && n[0] === "sanciones") || ((section === "disc" || section === "disc-nuevo") && n[0] === "lideres") ? ' aria-current="page"' : "") + ">" + esc(n[1]) + "</a></li>";
    }).join("");
    root.innerHTML = '<div class="pn"><nav class="pn-side" aria-label="Administración"><div class="pn-who">' + esc(info.alias) + "<br><small>" + esc(info.roleLabel) + '</small></div><ul>' + items + '</ul></nav>' +
      '<div class="pn-main"><div class="status-line" id="pn-msg" role="status"></div><div id="pn-body"></div></div></div>';
  }
  function body() { return document.getElementById("pn-body"); }
  function say(m, kind) { var e = document.getElementById("pn-msg"); if (e) { e.textContent = m || ""; e.className = "status-line " + (kind || ""); } }

  /* ----- Resumen ----- */
  function loadResumen() {
    body().innerHTML = '<div class="card"><h3>Resumen</h3><p class="help">Cargando…</p></div>';
    getJson("/api/admin/dashboard").then(function (j) {
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Resumen</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + "</p></div>"; return; }
      var cards = [["Jugadores registrados", j.players], ["Clanes registrados", j.clans], ["Partidos disputados (validados)", j.played],
        ["Pendientes de validar", j.toValidate], ["En disputa", j.disputed], ["Clanes con reportes pendientes", j.clansWithPending],
        ["Jugadores sancionados", j.sanctioned], ["Jugadores suspendidos", j.suspended], ["Jugadores baneados", j.banned], ["Denuncias abiertas", j.complaintsOpen], ["Apelaciones pendientes", j.appealsOpen], ["Clanes con reportes disciplinarios", j.clansWithDisc]];
      var rec = j.recent.length ? j.recent.map(function (r) {
        return "<tr><td>" + fdt(r.at) + "</td><td>" + esc(r.actor) + "</td><td>" + esc(ACTIONS[r.action] || r.action) + "</td><td>" + (r.type ? esc(r.type) + " #" + r.targetId : "—") + "</td><td>" + esc(r.reason) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="5">Todavía no hay actividad administrativa.</td></tr>';
      body().innerHTML = '<div class="pn-cards">' + cards.map(function (c) { return '<div class="pn-stat"><b>' + c[1] + "</b><span>" + esc(c[0]) + "</span></div>"; }).join("") + "</div>" +
        '<div class="card"><h3>Actividad administrativa reciente</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Registro</th><th>Motivo</th></tr></thead><tbody>' + rec + "</tbody></table></div></div>" +
        '<p class="help pn-note">Sanciones, jugadores suspendidos y reportes disciplinarios se agregarán a este resumen en las próximas partes del panel.</p>';
    });
  }

  /* ----- Partidos: lista ----- */
  function loadMatches() {
    var statusOpts = '<option value="">Todos (sin eliminados)</option>' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (mf.status === k ? " selected" : "") + ">" + esc(STATUS[k]) + "</option>"; }).join("");
    body().innerHTML = '<div class="card"><h3>Gestión de partidos</h3>' +
      '<form class="pn-filter" id="mf-form"><input type="search" id="mf-q" data-sg="any" autocomplete="off" placeholder="Clan, jugador o ID de partido" maxlength="40" value="' + esc(mf.q) + '" aria-label="Buscar"> ' +
      '<select id="mf-status" aria-label="Estado">' + statusOpts + '</select> <input type="text" id="mf-mode" placeholder="Modalidad" maxlength="30" value="' + esc(mf.mode) + '" aria-label="Modalidad"> ' +
      '<label>Desde <input type="date" id="mf-from" value="' + esc(mf.from) + '"></label> <label>Hasta <input type="date" id="mf-to" value="' + esc(mf.to) + '"></label> ' +
      '<button type="submit">Filtrar</button> <button type="button" class="linkbtn" id="mf-clear">Limpiar</button>' + (can("matches.edit") ? ' <button type="button" id="mf-new">Nuevo partido</button>' : "") + "</form>" +
      '<div id="mf-list"><p class="help">Cargando…</p></div></div>';
    var qs = "?page=" + mf.page + "&q=" + encodeURIComponent(mf.q) + "&status=" + mf.status + "&mode=" + encodeURIComponent(mf.mode) + (mf.from ? "&from=" + dayStart(mf.from) : "") + (mf.to ? "&to=" + dayEnd(mf.to) : "");
    getJson("/api/admin/matches" + qs).then(function (j) {
      var el = document.getElementById("mf-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.matches.length ? j.matches.map(function (m) {
        return '<tr><td><a href="#panel/partido/' + m.id + '">#' + m.id + "</a></td><td>" + fdt(m.date) + "</td><td>" + esc(m.winner) + "</td><td>" + esc(m.loser) + "</td><td>" +
          (m.scoreW >= 0 ? m.scoreW + " - " + m.scoreL : "—") + "</td><td>" + badge(m.status) + "</td><td>" + (esc(m.mode) || "—") + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="7">No hay partidos con esos filtros.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Fecha</th><th>Ganador</th><th>Perdedor</th><th>Marcador</th><th>Estado</th><th>Modalidad</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        '<p class="help">' + j.total + " partido(s)." + "</p>" + pager(j.page, j.total, j.per, "mpage");
    });
  }

  /* ----- Partidos: ficha ----- */
  function ids(list) { return list.map(function (x) { return x.id; }).join(", "); }
  function names(list) { return list.length ? list.map(function (x) { return esc(x.alias) + " (" + x.id + ")"; }).join(", ") : "—"; }
  function histCell(h) {
    var det = "";
    if (h.old || h.new) det = '<details><summary>Ver cambios</summary><div class="pn-diff"><b>Antes:</b> ' + esc(h.old || "—") + "<br><b>Después:</b> " + esc(h.new || "—") + "</div></details>";
    return det;
  }
  var cur = null;
  function loadMatch(id) {
    body().innerHTML = '<div class="card"><h3>Partido</h3><p class="help">Cargando…</p></div>';
    getJson("/api/admin/match?id=" + encodeURIComponent(id)).then(function (j) {
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Partido</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + '</p><p><a href="#panel/partidos">Volver a la lista</a></p></div>'; return; }
      cur = j; var m = j.match;
      var statusOpts = ["pending", "disputed", "confirmed", "rejected", "annulled"].map(function (k) { return '<option value="' + k + '"' + (m.status === k ? " selected" : "") + ">" + esc(STATUS[k]) + "</option>"; }).join("");
      var legacy = (m.status === "cancelled" || m.status === "deleted") ? '<option value="' + m.status + '" selected>' + esc(STATUS[m.status]) + "</option>" : "";
      var editable = j.canEdit && m.status !== "deleted";
      var form = editable ? '<form class="pn-form" id="pm-form" novalidate>' +
        '<label>Ganador<select id="pm-winner"><option value="' + m.winnerId + '" selected>' + esc(m.winner) + '</option><option value="' + m.loserId + '">' + esc(m.loser) + "</option></select></label>" +
        '<label>Marcador ganador<input type="number" id="pm-sw" min="0" max="999" value="' + (m.scoreW >= 0 ? m.scoreW : "") + '"></label>' +
        '<label>Marcador perdedor<input type="number" id="pm-sl" min="0" max="999" value="' + (m.scoreL >= 0 ? m.scoreL : "") + '"></label>' +
        '<label>Fecha y hora<input type="datetime-local" id="pm-date" value="' + toLocalInput(m.date) + '"></label>' +
        '<label>Modalidad<input type="text" id="pm-mode" maxlength="30" value="' + esc(m.mode) + '"></label>' +
        '<label>Estado<select id="pm-status">' + legacy + statusOpts + "</select></label>" +
        '<label class="wide">Jugadores ganadores (IDs separadas por coma)<input type="text" id="pm-wp" value="' + esc(ids(j.winnerPlayers)) + '"></label>' +
        '<label class="wide">Jugadores perdedores (IDs separadas por coma)<input type="text" id="pm-lp" value="' + esc(ids(j.loserPlayers)) + '"></label>' +
        '<label class="wide">Motivo del cambio (obligatorio)<textarea id="pm-reason" maxlength="500" rows="2" placeholder="Explica por qué se hace este cambio"></textarea></label>' +
        '<div class="wide"><button type="submit" id="pm-save">Guardar cambios</button></div></form>' : "";
      var acts = "";
      if (j.canDelete) {
        if (m.status === "deleted") acts += '<button type="button" data-pact="restore">Restaurar partido</button> ';
        else acts += '<button type="button" data-pact="delete">Eliminar (se puede restaurar)</button> ';
      }
      if (j.canHardDelete) acts += '<button type="button" class="danger" data-pact="hard_delete">Eliminar definitivamente</button>';
      var hist = j.history.length ? j.history.map(function (h) {
        return "<tr><td>" + fdt(h.at) + "</td><td>" + esc(h.actor) + "</td><td>" + esc(ACTIONS[h.action] || h.action) + "</td><td>" + esc(h.reason) + "</td><td>" + histCell(h) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="5">Sin cambios administrativos.</td></tr>';
      body().innerHTML = '<p><a href="#panel/' + lastSection + '">« Volver a ' + (lastSection === "reportes" ? "reportes" : "partidos") + "</a></p>" +
        '<div class="card"><h3>Partido #' + m.id + " " + badge(m.status) + '</h3><table class="dtable kv">' +
        "<tr><td>Temporada</td><td>" + esc(m.season || "—") + (m.seasonActive ? "" : " (cerrada)") + "</td></tr>" +
        "<tr><td>Ganador</td><td>" + esc(m.winner) + "</td></tr><tr><td>Perdedor</td><td>" + esc(m.loser) + "</td></tr>" +
        "<tr><td>Marcador</td><td>" + (m.scoreW >= 0 ? m.scoreW + " - " + m.scoreL : "—") + "</td></tr>" +
        "<tr><td>Fecha</td><td>" + fdt(m.date) + "</td></tr><tr><td>Modalidad</td><td>" + (esc(m.mode) || "—") + "</td></tr>" +
        "<tr><td>Reportó</td><td>" + (esc(m.reporter) || "—") + " · " + fdt(m.createdAt) + "</td></tr>" +
        "<tr><td>Confirmó</td><td>" + (esc(m.confirmer) || "—") + (m.resolvedAt ? " · " + fdt(m.resolvedAt) : "") + "</td></tr>" +
        "<tr><td>Comentario del reporte</td><td>" + (esc(m.reportComment) || "—") + "</td></tr><tr><td>Comentario de confirmación</td><td>" + (esc(m.confirmComment) || "—") + "</td></tr>" +
        "<tr><td>Jugadores ganadores</td><td>" + names(j.winnerPlayers) + "</td></tr><tr><td>Jugadores perdedores</td><td>" + names(j.loserPlayers) + "</td></tr></table>" +
        (m.reportState ? '<p class="help"><b>Marca del reporte:</b> ' + esc(FLAG[m.reportState] || m.reportState) + "</p>" : "") + (m.seasonActive ? "" : '<p class="help">Este partido es de una temporada cerrada: la tabla final ya está guardada, por eso no se puede cambiar el ganador ni el estado.</p>') + "</div>" +
        (form ? '<div class="card"><h3>Modificar partido</h3>' + form + '<p class="help">Al guardar, victorias, derrotas y rachas de los clanes se recalculan solas a partir de todos los partidos, sin duplicar nada.</p></div>' : "") +
        (acts ? '<div class="card"><h3>Eliminar o restaurar</h3><div class="pn-actions">' + acts + "</div></div>" : "") +
        '<div class="card"><h3>Historial de este partido</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Motivo</th><th>Detalle</th></tr></thead><tbody>' + hist + "</tbody></table></div></div>";
      body().lastElementChild.insertAdjacentHTML("beforebegin", reviewCards(j));
    });
  }
  function parseIds(v) { var t = String(v).replace(/[^\d,\s]/g, "").split(/[,\s]+/).filter(Boolean); return t.map(Number); }
  function saveMatch(e) {
    e.preventDefault();
    if (busy) return;
    var m = cur.match, v = function (id) { return document.getElementById(id).value; };
    var reason = v("pm-reason").trim();
    if (reason.length < 5) { say("Escribe el motivo del cambio (al menos 5 caracteres).", "err"); return; }
    var data = {
      id: m.id, rev: m.rev, reason: reason, winnerId: Number(v("pm-winner")), scoreW: v("pm-sw"), scoreL: v("pm-sl"),
      playedAt: fromLocalInput(v("pm-date")), mode: v("pm-mode"), status: v("pm-status"),
      winnerPlayers: parseIds(v("pm-wp")), loserPlayers: parseIds(v("pm-lp"))
    };
    var changesStats = data.winnerId !== m.winnerId || data.status !== m.status;
    var go = changesStats ? dialog("Este cambio modifica el resultado o el estado y recalculará las estadísticas de los clanes. ¿Continuar?", { ok: "Guardar" }) : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      busy = true; document.getElementById("pm-save").disabled = true;
      post("/api/admin/match/update", data).then(function (r) {
        busy = false;
        if (r.ok) { say("Cambios guardados y estadísticas recalculadas.", "ok"); loadMatch(m.id); } else { say(r.error || "No se pudo guardar.", "err"); var b = document.getElementById("pm-save"); if (b) b.disabled = false; }
      }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
    });
  }
  function matchAction(act) {
    var m = cur.match;
    var texts = { delete: "El partido dejará de contar en las estadísticas y desaparecerá de las listas públicas, pero podrás restaurarlo.", restore: "El partido volverá a su estado anterior y las estadísticas se recalcularán.", hard_delete: "Esto elimina el partido para siempre. No se puede deshacer; solo quedará el registro en el historial de auditoría." };
    var reason = "";
    dialog(texts[act] + "\n\nEscribe el motivo:", { input: "Motivo (obligatorio)", ok: "Continuar" }).then(function (r) {
      if (r === null) return null;
      reason = r;
      if (reason.length < 5) { say("Escribe el motivo del cambio (al menos 5 caracteres).", "err"); return null; }
      return act === "hard_delete" ? dialog("Para confirmar la eliminación definitiva, escribe ELIMINAR.", { input: "ELIMINAR", ok: "Eliminar" }) : true;
    }).then(function (c) {
      if (c === null || c === undefined) return;
      if (busy) return; busy = true;
      post("/api/admin/match/action", { id: m.id, rev: m.rev, action: act, reason: reason, confirmText: act === "hard_delete" ? c : undefined }).then(function (r) {
        busy = false;
        if (r.ok) { say(act === "hard_delete" ? "Partido eliminado definitivamente." : act === "delete" ? "Partido eliminado. Puedes restaurarlo." : "Partido restaurado.", "ok"); if (act === "hard_delete") location.hash = "#panel/partidos"; else loadMatch(m.id); }
        else say(r.error || "No se pudo completar.", "err");
      }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
    });
  }

  /* ----- Partidos: nuevo ----- */
  function newMatchForm() {
    getJson("/api/admin/clanlist").then(function (j) {
      var opts = (j.clans || []).map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + " (ID " + c.id + ")</option>"; }).join("");
      body().innerHTML = '<p><a href="#panel/partidos">« Volver a partidos</a></p><div class="card"><h3>Nuevo partido (registro manual)</h3><form class="pn-form" id="pn-form" novalidate>' +
        '<label>Clan ganador<select id="nm-w">' + opts + '</select></label><label>Clan perdedor<select id="nm-l">' + opts + '</select></label>' +
        '<label>Marcador ganador<input type="number" id="nm-sw" min="0" max="999"></label><label>Marcador perdedor<input type="number" id="nm-sl" min="0" max="999"></label>' +
        '<label>Fecha y hora<input type="datetime-local" id="nm-date"></label><label>Modalidad<input type="text" id="nm-mode" maxlength="30"></label>' +
        '<label>Estado inicial<select id="nm-status"><option value="confirmed">Validado</option><option value="pending">Reportado (pendiente)</option><option value="disputed">En disputa</option></select></label><span></span>' +
        '<label class="wide">Jugadores ganadores (IDs separadas por coma)<input type="text" id="nm-wp"></label><label class="wide">Jugadores perdedores (IDs separadas por coma)<input type="text" id="nm-lp"></label>' +
        '<label class="wide">Motivo (obligatorio)<textarea id="nm-reason" maxlength="500" rows="2"></textarea></label><div class="wide"><button type="submit" id="nm-save">Crear partido</button></div></form>' +
        '<p class="help">Útil cuando los clanes no reportaron un partido. Las IDs de jugadores están en «Lista de jugadores».</p></div>';
      var key = newKey();
      document.getElementById("pn-form").addEventListener("submit", function (e) {
        e.preventDefault(); if (busy) return;
        var v = function (id) { return document.getElementById(id).value; };
        var reason = v("nm-reason").trim();
        if (reason.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return; }
        busy = true; document.getElementById("nm-save").disabled = true;
        post("/api/admin/match/create", { key: key, reason: reason, winnerId: Number(v("nm-w")), loserId: Number(v("nm-l")), scoreW: v("nm-sw"), scoreL: v("nm-sl"), playedAt: fromLocalInput(v("nm-date")), mode: v("nm-mode"), status: v("nm-status"), winnerPlayers: parseIds(v("nm-wp")), loserPlayers: parseIds(v("nm-lp")) })
          .then(function (r) { busy = false; if (r.ok) { say("Partido creado.", "ok"); location.hash = "#panel/partido/" + r.id; } else { say(r.error || "No se pudo crear.", "err"); document.getElementById("nm-save").disabled = false; } })
          .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
      });
    });
  }


  /* ----- Revisión de un reporte: acciones, evidencias y notas ----- */
  function reviewCards(j) {
    var m = j.match, html = "";
    if (j.canReview && m.status !== "deleted") {
      var b = "";
      if (j.canEdit) {
        b += '<button type="button" data-rv="approve">Aprobar y validar</button> <button type="button" data-rv="reject">Rechazar</button> <button type="button" data-rv="duplicate">Marcar duplicado</button> <button type="button" data-rv="invalid">Marcar inválido</button> ';
      }
      b += '<button type="button" data-rv="needs_info">Pedir más información</button> <button type="button" data-rv="dispute">Abrir disputa</button>';
      if (m.reportState) b += ' <button type="button" data-rv="clear">Quitar marca</button>';
      html += '<div class="card"><h3>Revisión del reporte</h3><div class="pn-actions">' + b + '</div><p class="help">Aprobar exige que estén marcados los jugadores ganadores en «Modificar partido». Duplicado e inválido anulan el reporte y recalculan las estadísticas. Cada acción pide un motivo.</p></div>';
    }
    var ev = j.evidence.length ? j.evidence.map(function (e) {
      var view = e.kind === "link" ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.label || e.url) + "</a>"
        : '<a href="' + esc(e.url) + '" target="_blank" rel="noopener"><img class="pn-thumb" src="' + esc(e.url) + '" alt="' + esc(e.label) + '"></a><br>' + esc(e.label);
      return "<li>" + view + " <small>· " + esc(e.by) + " · " + fdt(e.at) + (e.hidden ? " · <b>oculta para los clanes</b>" : "") + "</small>" +
        (j.canReview ? ' <button type="button" class="linkbtn" data-evhide="' + e.id + '" data-hide="' + (e.hidden ? "0" : "1") + '">' + (e.hidden ? "Mostrar" : "Ocultar") + "</button>" : "") + "</li>";
    }).join("") : '<li class="none">Sin evidencias.</li>';
    html += '<div class="card"><h3>Evidencias</h3><ul class="pn-ev">' + ev + "</ul>" +
      (j.canEvidence && m.status !== "deleted" ? '<form class="pn-form" id="ev-link-form" novalidate><label>Enlace (video, imagen, etc.)<input type="url" id="ev-url" maxlength="400" placeholder="https://"></label><label>Descripción<input type="text" id="ev-label" maxlength="80"></label><div class="wide"><button type="submit">Agregar enlace</button> <label class="pn-inline">o subir captura (PNG, JPG, WEBP o GIF, máx. 4 MB) <input type="file" id="ev-file" accept="image/png,image/jpeg,image/webp,image/gif"></label></div></form>' : "") + "</div>";
    if (j.canReview) {
      var notes = j.notes.length ? j.notes.map(function (n) {
        return "<li>" + (n.kind === "resolution" ? '<span class="badge st-confirmed">Visible para los clanes</span>' : '<span class="badge">Privada</span>') + " " + esc(n.text) + " <small>· " + esc(n.by) + " · " + fdt(n.at) + "</small></li>";
      }).join("") : '<li class="none">Sin notas.</li>';
      html += '<div class="card"><h3>Notas y resoluciones</h3><ul class="pn-ev">' + notes + '</ul><form class="pn-form" id="note-form" novalidate><label>Tipo<select id="note-kind"><option value="private">Nota privada (solo administración)</option><option value="resolution">Resolución visible para los clanes</option></select></label><span></span><label class="wide">Texto<textarea id="note-text" maxlength="1000" rows="2"></textarea></label><div class="wide"><button type="submit">Guardar nota</button></div></form></div>';
    }
    return html;
  }
  function reviewAction(act) {
    var m = cur.match;
    var texts = {
      approve: "Se validará el reporte y el ganador sumará su victoria.", reject: "Se rechazará el reporte: no contará para ninguno de los dos clanes.",
      duplicate: "Se anulará el reporte por duplicado y se recalcularán las estadísticas.", invalid: "Se anulará el reporte por inválido y se recalcularán las estadísticas.",
      needs_info: "Se marcará como pendiente de información y los clanes verán el motivo.", dispute: "Se abrirá una disputa: los clanes verán el motivo.", clear: "Se quitará la marca del reporte."
    };
    dialog(texts[act] + "\n\nEscribe el motivo:", { input: "Motivo (obligatorio)", ok: "Continuar" }).then(function (reason) {
      if (reason === null) return;
      if (reason.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return; }
      if (busy) return; busy = true;
      var p;
      if (act === "approve" || act === "reject") p = post("/api/admin/match/update", { id: m.id, rev: m.rev, status: act === "approve" ? "confirmed" : "rejected", reason: reason });
      else if (act === "dispute") p = post("/api/admin/report/dispute", { id: m.id, rev: m.rev, reason: reason });
      else p = post("/api/admin/report/flag", { id: m.id, rev: m.rev, flag: act, reason: reason });
      p.then(function (r) { busy = false; if (r.ok) { say("Listo. Las estadísticas se actualizaron si hacía falta.", "ok"); loadMatch(m.id); } else say(r.error || "No se pudo completar.", "err"); })
        .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
    });
  }
  function uploadGeneric(file, type, id, done) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { say("La imagen supera los 4 MB.", "err"); return; }
    if (busy) return; busy = true;
    fetch("/api/evidence/upload?type=" + type + "&id=" + id + "&name=" + encodeURIComponent(file.name.slice(0, 60)), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, credentials: "same-origin", body: file })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); })
      .then(function (r) { busy = false; if (r.ok) { say("Captura subida.", "ok"); done(); } else say(r.error || "No se pudo subir.", "err"); })
      .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }
  function uploadFile(file, matchId, done) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { say("La imagen supera los 4 MB.", "err"); return; }
    if (busy) return; busy = true;
    fetch("/api/evidence/upload?type=match&id=" + matchId + "&name=" + encodeURIComponent(file.name.slice(0, 60)), { method: "POST", headers: { "Content-Type": "application/octet-stream" }, credentials: "same-origin", body: file })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; }); })
      .then(function (r) { busy = false; if (r.ok) { say("Captura subida.", "ok"); done(); } else say(r.error || "No se pudo subir.", "err"); })
      .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }

  /* ----- Reportes: cola de revisión ----- */
  function loadReports() {
    var tabs = [["queue", "Pendientes de revisión"], ["flagged", "Marcados"], ["all", "Todos"], ["deleted", "Eliminados"]].map(function (t) {
      return '<button type="button" class="pn-tab' + (rf.view === t[0] ? " on" : "") + '" data-rtab="' + t[0] + '">' + t[1] + "</button>";
    }).join("");
    body().innerHTML = '<div class="card" id="al-card" hidden></div><div class="card"><h3>Gestión de reportes</h3><div class="pn-tabs">' + tabs + "</div>" +
      '<form class="pn-filter" id="rf-form"><input type="search" id="rf-q" data-sg="any" autocomplete="off" placeholder="Clan o jugador que reportó" maxlength="40" value="' + esc(rf.q) + '"> <button type="submit">Buscar</button></form><div id="rf-list"><p class="help">Cargando…</p></div></div>';
    getJson("/api/admin/alerts").then(function (a) {
      var el = document.getElementById("al-card"); if (!el || a.status !== 200 || !a.alerts.length) return;
      el.hidden = false;
      el.innerHTML = "<h3>Alertas: reportes sin confirmar tras " + a.hours + " horas</h3><ul>" + a.alerts.map(function (x) {
        return '<li><a href="#panel/partido/' + x.id + '">Partido #' + x.id + "</a> · " + esc(x.loser) + " reportó derrota ante " + esc(x.winner) + " hace " + x.waitingHours + " h. Debe responder: " + (x.responsibles.map(esc).join(", ") || "sin responsables") + ".</li>";
      }).join("") + '</ul><p class="help">Revisa cada caso antes de actuar: la plataforma no sanciona sola.</p>';
    });
    getJson("/api/admin/reports?view=" + rf.view + "&page=" + rf.page + "&q=" + encodeURIComponent(rf.q)).then(function (j) {
      var el = document.getElementById("rf-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.reports.length ? j.reports.map(function (r) {
        var hrs = Math.floor((Date.now() - r.createdAt) / 3600000);
        return '<tr><td><a href="#panel/partido/' + r.id + '">#' + r.id + "</a></td><td>" + fdt(r.createdAt) + "<br><small>hace " + (hrs < 48 ? hrs + " h" : Math.floor(hrs / 24) + " días") + "</small></td><td>" + esc(r.reporter) + "</td><td>" + esc(r.winner) + "</td><td>" + esc(r.loser) + "</td><td>" + badge(r.status) + (r.flag ? " " + '<span class="badge st-disputed">' + esc(FLAG[r.flag] || r.flag) + "</span>" : "") + "</td><td>" + r.evidence + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="7">No hay reportes en esta lista.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Reportado</th><th>Envió</th><th>Ganador</th><th>Perdedor</th><th>Estado</th><th>Evid.</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">" + j.total + " reporte(s).</p>" + pager(j.page, j.total, j.per, "rpage");
    });
  }

  /* ----- Avisos y evidencias para los líderes (en «Manejo de cuenta») ----- */
  var noticesBox = document.getElementById("my-notices");
  var apKey = newKey(), cpKey = newKey();
  function loadNotices() {
    if (!noticesBox) return;
    getJson("/api/my/admin").then(function (j) {
      if (j.status !== 200) { noticesBox.hidden = true; return; }
      var h = "";
      var sans = (j.sanctions || []);
      if (sans.length) {
        h += "<h3>Mis sanciones</h3><ul class=\"pn-ev\">" + sans.map(function (x) {
          return "<li><b>" + esc(x.typeLabel) + "</b> " + sBadge(x.status) + (x.targetType === "clan" ? " (a tu clan)" : "") + "<div>Motivo: " + esc(x.reason) + " · Gravedad: " + esc(SEV[x.severity] || x.severity) + "</div><div>" + esc(x.description) + "</div>" + (x.rules ? "<div><small>Reglas: " + esc(x.rules) + "</small></div>" : "") +
            "<div><small>Desde " + fdt(x.startsAt) + (x.endsAt ? " hasta " + fdt(x.endsAt) : " · sin vencimiento") + "</small></div>" +
            (x.appealStatus ? "<div>Apelación: <b>" + ({ pending: "pendiente de revisión", accepted: "aceptada", rejected: "rechazada" }[x.appealStatus] || esc(x.appealStatus)) + "</b>" + (x.appealResolution ? " — " + esc(x.appealResolution) : "") + "</div>" : "") +
            (x.canAppeal ? '<form class="pn-form my-appeal" data-id="' + x.id + '" novalidate><label class="wide">Apelar (hasta el ' + fdt(x.appealUntil) + ')<textarea maxlength="1000" rows="2" placeholder="Explica por qué la sanción debería revisarse (mínimo 20 caracteres)"></textarea></label><div class="wide"><button type="submit">Enviar apelación</button></div></form>' : "") + "</li>";
        }).join("") + "</ul>";
      }
      var discs = (j.discs || []);
      if (discs.length) {
        h += "<h3>Reportes de la administración a tu clan</h3><ul class=\"pn-ev\">" + discs.map(function (d) {
          return "<li><b>" + esc(d.clan) + "</b> · " + esc(d.reason) + " " + dBadge(d.status) + "<div>" + esc(d.description) + "</div>" + (d.deadlineAt ? "<div><small>Plazo para responder: " + fdt(d.deadlineAt) + "</small></div>" : "") +
            (d.response ? "<div><b>Tu respuesta:</b> " + esc(d.response) + "</div>" : "") + (d.resolution ? "<div><b>Resolución:</b> " + esc(d.resolution) + (d.measures ? " · Medidas: " + esc(d.measures) : "") + "</div>" : "") +
            (!d.response && d.status !== "resolved" && d.status !== "closed" ? '<form class="pn-form my-disc" data-id="' + d.id + '" novalidate><label class="wide">Tu respuesta<textarea maxlength="1500" rows="2"></textarea></label><div class="wide"><button type="submit">Responder</button></div></form>' : "") + "</li>";
        }).join("") + "</ul>";
      }
      var cps = (j.complaints || []);
      if (cps.length) h += "<h3>Mis denuncias</h3><ul class=\"pn-ev\">" + cps.map(function (c) { return "<li>Denuncia #" + c.id + " contra " + esc(c.accused) + " · " + cBadge(c.status) + " <small>" + fdt(c.at) + "</small></li>"; }).join("") + "</ul>";
      if (j.matches && j.matches.length) {
        h += "<h3>Mensajes y evidencias de tus partidos</h3><ul class=\"pn-ev\">" + j.matches.map(function (m) {
          var res = m.resolutions.map(function (r) { return '<div class="pn-res"><b>Administración:</b> ' + esc(r.text) + " <small>" + fdt(r.at) + "</small></div>"; }).join("");
          var ev = m.evidence.map(function (e) { return e.kind === "link" ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.label) + "</a>" : '<a href="' + esc(e.url) + '" target="_blank" rel="noopener"><img class="pn-thumb" src="' + esc(e.url) + '" alt="' + esc(e.label) + '"></a>'; }).join(" ");
          return "<li><b>Partido #" + m.id + "</b> · " + esc(m.winner) + " vs " + esc(m.loser) + " · " + badge(m.status) + (m.flag === "needs_info" ? ' <span class="badge st-disputed">Falta información</span>' : "") + res + (ev ? '<div class="pn-evrow">' + ev + "</div>" : "") +
            (m.status === "confirmed" ? "" : '<label class="pn-inline">Adjuntar captura <input type="file" class="my-ev" data-mid="' + m.id + '" accept="image/png,image/jpeg,image/webp,image/gif"></label>') + "</li>";
        }).join("") + "</ul>";
      }
      h += '<details class="my-report"><summary>Denunciar a un jugador (trampas o conducta)</summary><form class="pn-form" id="my-cmp" novalidate><label>Nick del jugador<input type="text" id="mc-acc" data-sg="player" autocomplete="off" maxlength="40"></label><label>Clan del jugador<input type="text" id="mc-clan" readonly tabindex="-1" placeholder="Se completa al elegir el jugador"></label><label>Fecha de la falta<input type="date" id="mc-date" max="'+new Date().toISOString().slice(0,10)+'"></label><label>IP del servidor donde se jugó<input type="text" id="mc-ip" maxlength="60" autocomplete="off" placeholder="Ej. 200.1.2.3:12203"></label><label class="wide">¿Qué ocurrió?<textarea id="mc-desc" maxlength="2000" rows="3" placeholder="Describe lo ocurrido con el mayor detalle (mínimo 20 caracteres)"></textarea></label><label class="wide">Enlaces con evidencia (opcional, uno por línea)<textarea id="mc-links" maxlength="600" rows="2"></textarea></label><div class="wide"><button type="submit">Enviar denuncia</button></div></form><p class="help">Una denuncia no es una acusación probada: la administración revisa las evidencias antes de decidir. Las denuncias falsas pueden ser sancionadas.</p></details><div class="status-line" id="my-msg" role="status"></div>';
      noticesBox.hidden = false;
      noticesBox.innerHTML = h;
    }).catch(function () { noticesBox.hidden = true; });
  }
  function mcDate() {
    var v = document.getElementById("mc-date").value; if (!v) return 0;
    var t = new Date(v + "T12:00:00").getTime(); return isNaN(t) ? 0 : Math.min(t, Date.now());
  }
  function myMsg(t, k) { var e = document.getElementById("my-msg"); if (e) { e.textContent = t; e.className = "status-line " + (k || ""); } }
  if (noticesBox) {
    var view = document.getElementById("view-mi-clan");
    new MutationObserver(function () { if (!view.hidden) loadNotices(); }).observe(view, { attributes: true, attributeFilter: ["hidden"] });
    noticesBox.addEventListener("submit", function (e) {
      e.preventDefault(); var f = e.target; if (busy) return;
      if (f.classList.contains("my-appeal") || f.classList.contains("my-disc")) {
        var txt = f.querySelector("textarea").value.trim(), ap = f.classList.contains("my-appeal");
        if (txt.length < (ap ? 20 : 10)) { myMsg("El texto es demasiado corto.", "err"); return; }
        busy = true;
        post(ap ? "/api/appeal" : "/api/disc/respond", ap ? { sanctionId: Number(f.getAttribute("data-id")), text: txt } : { id: Number(f.getAttribute("data-id")), text: txt }).then(function (r) { busy = false; if (r.ok) loadNotices(); else myMsg(r.error || "No se pudo enviar.", "err"); }).catch(function () { busy = false; myMsg("No hay conexión con el servidor.", "err"); });
      } else if (f.id === "my-cmp") {
        var links = document.getElementById("mc-links").value.split(/\s+/).filter(Boolean).slice(0, 3);
        busy = true;
        post("/api/complaint/create", { accusedAlias: document.getElementById("mc-acc").value.trim(), incidentAt: mcDate(), serverIp: document.getElementById("mc-ip").value.trim(), description: document.getElementById("mc-desc").value.trim(), links: links, key: cpKey }).then(function (r) { busy = false; if (r.ok) { cpKey = newKey(); loadNotices(); setTimeout(function () { myMsg("Denuncia enviada. La administración la revisará.", "ok"); }, 300); } else myMsg(r.error || "No se pudo enviar.", "err"); }).catch(function () { busy = false; myMsg("No hay conexión con el servidor.", "err"); });
      }
    });
    noticesBox.addEventListener("change", function (e) {
      var inp = e.target; if (!inp.classList || !inp.classList.contains("my-ev")) return;
      uploadFile(inp.files[0], inp.getAttribute("data-mid"), loadNotices);
      inp.value = "";
    });
  }


  /* ===== Parte 3: jugadores, clanes y líderes ===== */
  var ROLE_ES = { leader: "Líder", coleader: "Colíder", captain: "Capitán", member: "Miembro" };
  var STAFF_ES = { news: "Encargado de noticias", moderator: "Moderador", admin: "Administrador", superadmin: "Superadministrador" };
  function askReason(text) {
    return dialog(text + "\n\nEscribe el motivo:", { input: "Motivo (obligatorio)", ok: "Continuar" }).then(function (r) {
      if (r === null) return null;
      if (r.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return null; }
      return r;
    });
  }
  // Envía una acción con motivo, evita doble envío y recarga la ficha.
  function act(text, url, data, okMsg, reload) {
    askReason(text).then(function (reason) {
      if (reason === null || busy) return;
      busy = true; data.reason = reason;
      post(url, data).then(function (r) { busy = false; if (r.ok) { say(okMsg, "ok"); reload(); } else say(r.error || "No se pudo completar.", "err"); })
        .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
    });
  }
  function notesHtml(list) {
    return list.length ? list.map(function (n) { return "<li>" + esc(n.text) + " <small>· " + esc(n.by) + " · " + fdt(n.at) + (n.public ? " · <b>público</b>" : "") + "</small></li>"; }).join("") : '<li class="none">Sin notas.</li>';
  }
  function histRows(h) {
    return h.length ? h.map(function (x) { return "<tr><td>" + fdt(x.at) + "</td><td>" + esc(x.actor) + "</td><td>" + esc(ACTIONS[x.action] || x.action) + "</td><td>" + esc(x.reason) + "</td><td>" + histCell(x) + "</td></tr>"; }).join("") : '<tr><td class="none" colspan="5">Sin cambios administrativos.</td></tr>';
  }
  function adjRows(list, kind, canAdj) {
    return list.length ? list.map(function (a) {
      return "<tr><td>" + fdt(a.at) + "</td><td>" + (a.wins > 0 ? "+" : "") + a.wins + " / " + (a.losses > 0 ? "+" : "") + a.losses + "</td><td>" + esc(a.reason) + "<br><small>" + esc(a.by) + "</small></td><td>" +
        (a.revoked ? "Revertido" : !a.current ? "Temporada cerrada" : canAdj ? '<button type="button" class="linkbtn" data-adjrev="' + a.id + '" data-kind="' + kind + '">Revertir</button>' : "Vigente") + "</td></tr>";
    }).join("") : '<tr><td class="none" colspan="4">Sin ajustes administrativos.</td></tr>';
  }
  function adjForm(id, kind) {
    return '<form class="pn-form" id="adj-form" data-kind="' + kind + '" data-id="' + id + '" novalidate><label>Victorias (+ o −)<input type="number" id="adj-w" min="-50" max="50" value="0"></label><label>Derrotas (+ o −)<input type="number" id="adj-l" min="-50" max="50" value="0"></label>' +
      '<div class="wide"><button type="submit">Registrar ajuste excepcional</button></div></form><p class="help">Un ajuste no cambia los partidos: queda registrado aparte (con motivo, quién lo hizo y los valores antes y después), el recálculo automático lo respeta y se puede revertir.</p>';
  }
  var adjKey = newKey(), pnoteKey = newKey();

  function loadPlayers() {
    body().innerHTML = '<div class="card"><h3>Gestión de jugadores</h3><form class="pn-filter" id="pf-form"><input type="search" id="pf-q" data-sg="player" autocomplete="off" placeholder="Nick, ID o clan" maxlength="40" value="' + esc(pf.q) + '"> <select id="pf-status"><option value="">Todos</option><option value="active"' + (pf.status === "active" ? " selected" : "") + '>Activos</option><option value="inactive"' + (pf.status === "inactive" ? " selected" : "") + '>Desactivados</option><option value="staff"' + (pf.status === "staff" ? " selected" : "") + '>Personal</option></select> <button type="submit">Buscar</button></form><div id="pf-list"><p class="help">Cargando…</p></div></div>';
    getJson("/api/admin/players?page=" + pf.page + "&q=" + encodeURIComponent(pf.q) + "&status=" + pf.status).then(function (j) {
      var el = document.getElementById("pf-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.players.length ? j.players.map(function (p) {
        return '<tr><td>' + p.id + '</td><td><a href="#panel/jugador/' + p.id + '">' + esc(p.alias) + "</a>" + (p.staff ? ' <span class="badge">' + esc(STAFF_ES[p.staff]) + "</span>" : "") + "</td><td>" + (p.clanId ? '<a href="#panel/clan/' + p.clanId + '">' + esc(p.clan) + "</a> · " + esc(ROLE_ES[p.clanRole]) : "Sin clan") + "</td><td>" + p.wins + " / " + p.losses + "</td><td>" + (p.active ? '<span class="badge st-confirmed">Activa</span>' : '<span class="badge st-rejected">Desactivada</span>') + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="5">No hay jugadores con esos filtros.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Jugador</th><th>Clan</th><th>Gan. / Perd.</th><th>Cuenta</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">" + j.total + " jugador(es).</p>" + pager(j.page, j.total, j.per, "ppage");
    });
  }

  function loadPlayer(id) {
    body().innerHTML = '<div class="card"><h3>Jugador</h3><p class="help">Cargando…</p></div>';
    Promise.all([getJson("/api/admin/player?id=" + encodeURIComponent(id)), getJson("/api/admin/clanlist")]).then(function (rs) {
      var j = rs[0]; var clans = rs[1].clans || [];
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Jugador</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + '</p><p><a href="#panel/jugadores">Volver</a></p></div>'; return; }
      curP = j; var p = j.player, s = j.stats;
      var mrows = j.matches.length ? j.matches.map(function (m) {
        var res = m.side === "winner" ? (m.status === "confirmed" ? "Victoria" : STATUS[m.status]) : (m.status === "pending" || m.status === "confirmed" || m.status === "disputed" ? "Derrota" : STATUS[m.status]);
        return '<tr><td><a href="#panel/partido/' + m.id + '">#' + m.id + "</a></td><td>" + fdt(m.date) + "</td><td>" + esc(m.winner) + " vs " + esc(m.loser) + "</td><td>" + esc(res) + "</td><td>" + (m.current ? "Temporada activa" : "Anterior") + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="5">Todavía no participó en partidos.</td></tr>';
      var clanOpts = '<option value="0">Sin clan</option>' + clans.map(function (c) { return '<option value="' + c.id + '"' + (j.clan && j.clan.id === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("");
      var roleOpts = ["member", "captain", "coleader", "leader"].map(function (r) { return '<option value="' + r + '"' + (j.clan && j.clan.role === r ? " selected" : "") + ">" + ROLE_ES[r] + "</option>"; }).join("");
      var edit = j.canEdit ? '<div class="card"><h3>Cuenta y clan</h3><form class="pn-form" id="pl-rename" novalidate><label>Nuevo nick<input type="text" id="pl-alias" maxlength="24" value="' + esc(p.alias) + '"></label><div><button type="submit">Cambiar nick</button></div></form>' +
        '<form class="pn-form" id="pl-move" novalidate><label>Clan<select id="pl-clan">' + clanOpts + '</select></label><label>Rol en el clan<select id="pl-role">' + roleOpts + '</select></label><div class="wide"><button type="submit">Guardar clan y rol</button></div></form>' +
        '<div class="pn-actions"><button type="button" data-pl="' + (p.active ? "deactivate" : "activate") + '">' + (p.active ? "Desactivar cuenta" : "Activar cuenta") + '</button></div><p class="help">Desactivar cierra sus sesiones y le impide entrar. Un Líder único no se puede mover: primero designa otro Líder en la ficha del clan. Las sanciones se aplican desde la sección «Sanciones» de esta ficha.</p></div>' : "";
      var adj = '<div class="card"><h3>Estadísticas de la temporada activa</h3><table class="dtable kv"><tr><td>Victorias</td><td>' + s.wins + "</td></tr><tr><td>Derrotas</td><td>" + s.losses + "</td></tr><tr><td>Porcentaje de victorias</td><td>" + s.pct + "%</td></tr><tr><td>Empates</td><td>No existen en esta Ladder</td></tr></table>" +
        '<h4 class="sub">Ajustes administrativos</h4><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Vict. / Derr.</th><th>Motivo</th><th></th></tr></thead><tbody>' + adjRows(j.adjustments, "player", j.canAdjust) + "</tbody></table></div>" + (j.canAdjust && s.seasonActive ? adjForm(p.id, "player") : "") + "</div>";
      body().innerHTML = '<p><a href="#panel/jugadores">« Volver a jugadores</a></p><div class="card"><h3>' + esc(p.alias) + " " + (p.active ? '<span class="badge st-confirmed">Activa</span>' : '<span class="badge st-rejected">Desactivada</span>') + '</h3><table class="dtable kv">' +
        "<tr><td>ID de jugador</td><td>" + p.id + "</td></tr>" + (p.email ? "<tr><td>Email</td><td>" + esc(p.email) + "</td></tr>" : "") + "<tr><td>Registro</td><td>" + fdt(p.created) + "</td></tr><tr><td>Cuenta validada</td><td>" + (p.verified ? "Sí" : "No") + "</td></tr>" +
        "<tr><td>Rol en la administración</td><td>" + (p.staff ? esc(STAFF_ES[p.staff]) : "—") + "</td></tr><tr><td>Clan</td><td>" + (j.clan ? '<a href="#panel/clan/' + j.clan.id + '">' + esc(j.clan.name) + "</a> · " + esc(ROLE_ES[j.clan.role]) : "Sin clan") + "</td></tr>" +
        "</table></div>" + adj + edit +
        '<div class="card"><h3>Historial de partidos</h3><div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Fecha</th><th>Partido</th><th>Resultado</th><th>Temporada</th></tr></thead><tbody>' + mrows + "</tbody></table></div></div>" +
        (j.canNote ? '<div class="card"><h3>Notas privadas</h3><ul class="pn-ev">' + notesHtml(j.notes) + '</ul><form class="pn-form" id="pnote-form" data-type="player" data-id="' + p.id + '" novalidate><label class="wide">Nueva nota<textarea id="pnote-text" maxlength="1000" rows="2"></textarea></label><label class="wide chk"><input type="checkbox" id="pnote-pub" checked> Mostrar como comentario en el perfil público (lo ve cualquiera, incluso invitados)</label><div class="wide"><button type="submit">Guardar nota</button></div></form></div>' : "") +
        '<div class="card"><h3>Sanciones</h3>' + (j.canSanction ? '<p><a class="btnlink" href="#panel/sancion-nueva/player/' + p.id + '">Aplicar sanción</a></p>' : "") + '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Tipo</th><th>Motivo</th><th>Gravedad</th><th>Estado</th><th>Vigencia</th></tr></thead><tbody>' + sanctionRows(j.sanctions || [], false) + "</tbody></table></div>" +
        ((j.complaints || []).length ? '<h4 class="sub">Denuncias</h4><ul class="pn-ev">' + j.complaints.map(function (c) { return '<li><a href="#panel/denuncia/' + c.id + '">Denuncia #' + c.id + "</a> · " + c.role + " · " + cBadge(c.status) + " <small>" + fdt(c.at) + "</small></li>"; }).join("") + "</ul>" : "") + "</div>" +
        '<div class="card"><h3>Historial administrativo</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Motivo</th><th>Detalle</th></tr></thead><tbody>' + histRows(j.history) + "</tbody></table></div></div>";
    });
  }

  function loadClans() {
    body().innerHTML = '<div class="card"><h3>Gestión de clanes</h3><form class="pn-filter" id="cf-form"><input type="search" id="cf-q" data-sg="clan" autocomplete="off" placeholder="Nombre o ID del clan" maxlength="40" value="' + esc(cf.q) + '"> <button type="submit">Buscar</button></form><div id="cf-list"><p class="help">Cargando…</p></div></div>';
    getJson("/api/admin/clans?page=" + cf.page + "&q=" + encodeURIComponent(cf.q)).then(function (j) {
      var el = document.getElementById("cf-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.clans.length ? j.clans.map(function (c) {
        return "<tr><td>" + c.id + '</td><td><a href="#panel/clan/' + c.id + '">' + esc(c.name) + "</a></td><td>" + (esc(c.leader) || "—") + "</td><td>" + c.members + "</td><td>" + c.wins + " / " + c.losses + "</td><td>" + (c.pending ? '<span class="badge st-pending">' + c.pending + " pendiente(s)</span>" : "—") + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="6">No hay clanes con ese filtro.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Clan</th><th>Líder</th><th>Integrantes</th><th>Gan. / Perd.</th><th>Reportes abiertos</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">" + j.total + " clan(es).</p>" + pager(j.page, j.total, j.per, "cpage");
    });
  }

  function loadClan(id) {
    body().innerHTML = '<div class="card"><h3>Clan</h3><p class="help">Cargando…</p></div>';
    getJson("/api/admin/clan?id=" + encodeURIComponent(id)).then(function (j) {
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Clan</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + '</p><p><a href="#panel/clanes">Volver</a></p></div>'; return; }
      curC = j; var c = j.clan;
      var mem = j.members.map(function (m) {
        var b = "";
        if (j.canEdit) {
          if (m.role !== "leader") b += '<button type="button" class="linkbtn" data-cl="set_main" data-pid="' + m.id + '">Hacer líder principal</button> ';
          if (m.role === "member" || m.role === "captain") b += '<button type="button" class="linkbtn" data-cl="set_co" data-pid="' + m.id + '">Designar colíder</button> ';
          if (m.role === "coleader") b += '<button type="button" class="linkbtn" data-cl="revoke_co" data-pid="' + m.id + '">Quitar colíder</button>';
        }
        return '<tr><td><a href="#panel/jugador/' + m.id + '">' + esc(m.alias) + "</a></td><td>" + ROLE_ES[m.role] + "</td><td>" + m.wins + " / " + m.losses + "</td><td>" + b + "</td></tr>";
      }).join("");
      var ms = j.matches.length ? j.matches.map(function (m) { return '<tr><td><a href="#panel/partido/' + m.id + '">#' + m.id + "</a></td><td>" + fdt(m.date) + "</td><td>" + esc(m.winner) + " vs " + esc(m.loser) + "</td><td>" + badge(m.status) + "</td></tr>"; }).join("") : '<tr><td class="none" colspan="4">Sin partidos.</td></tr>';
      var open = j.matches.filter(function (m) { return m.open; }).length;
      var edit = j.canEdit ? '<div class="card"><h3>Información administrativa</h3><form class="pn-form" id="cl-edit" novalidate><label>Nombre<input type="text" id="cl-name" maxlength="30" value="' + esc(c.name) + '"></label><label>Tag<input type="text" id="cl-tag" maxlength="8" value="' + esc(c.tag) + '"></label><label>Sitio web<input type="text" id="cl-web" maxlength="300" value="' + esc(c.website) + '"></label><label>Logo (enlace)<input type="text" id="cl-logo" maxlength="300" value="' + esc(c.logo) + '"></label><div class="wide"><button type="submit">Guardar</button></div></form></div>' : "";
      body().innerHTML = '<p><a href="#panel/clanes">« Volver a clanes</a></p><div class="card"><h3>' + esc(c.name) + (c.tag ? " [" + esc(c.tag) + "]" : "") + '</h3><table class="dtable kv"><tr><td>ID del clan</td><td>' + c.id + "</td></tr><tr><td>Victorias / derrotas</td><td>" + c.wins + " / " + c.losses + " (" + c.pct + "%)</td></tr><tr><td>Racha</td><td>" + c.streak + "</td></tr><tr><td>Creado</td><td>" + fdt(c.created) + "</td></tr><tr><td>Reportes abiertos</td><td>" + open + "</td></tr></table></div>" +
        '<div class="card"><h3>Integrantes y liderazgo</h3><div class="scroll"><table class="dtable"><thead><tr><th>Jugador</th><th>Rango</th><th>Gan. / Perd.</th><th></th></tr></thead><tbody>' + mem + "</tbody></table></div></div>" + edit +
        '<div class="card"><h3>Estadísticas: ajustes administrativos</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Vict. / Derr.</th><th>Motivo</th><th></th></tr></thead><tbody>' + adjRows(j.adjustments, "clan", j.canAdjust) + "</tbody></table></div>" + (j.canAdjust ? adjForm(c.id, "clan") : "") + "</div>" +
        '<div class="card"><h3>Partidos y reportes</h3><div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Fecha</th><th>Partido</th><th>Estado</th></tr></thead><tbody>' + ms + "</tbody></table></div><p class=\"help\">Para resolver una disputa abre el partido y usa «Revisión del reporte».</p></div>" +
        (j.canNote ? '<div class="card"><h3>Notas privadas</h3><ul class="pn-ev">' + notesHtml(j.notes) + '</ul><form class="pn-form" id="pnote-form" data-type="clan" data-id="' + c.id + '" novalidate><label class="wide">Nueva nota<textarea id="pnote-text" maxlength="1000" rows="2"></textarea></label><div class="wide"><button type="submit">Guardar nota</button></div></form></div>' : "") +
        '<div class="card"><h3>Historial administrativo del clan</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Motivo</th><th>Detalle</th></tr></thead><tbody>' + histRows(j.history) + "</tbody></table></div></div>" +
        '<div class="card"><h3>Sanciones y reportes disciplinarios' + (j.suspended ? ' <span class="badge st-rejected">Clan suspendido</span>' : "") + '</h3>' + (j.canSanction ? '<p><a class="btnlink" href="#panel/sancion-nueva/clan/' + c.id + '">Aplicar sanción al clan</a> · <a class="btnlink" href="#panel/disc-nuevo/' + c.id + '">Nuevo reporte a líder</a></p>' : "") +
        '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Tipo</th><th>Motivo</th><th>Gravedad</th><th>Estado</th><th>Vigencia</th></tr></thead><tbody>' + sanctionRows(j.sanctions || [], false) + "</tbody></table></div>" +
        ((j.discs || []).length ? '<h4 class="sub">Reportes disciplinarios</h4><ul class="pn-ev">' + j.discs.map(function (d) { return '<li><a href="#panel/disc/' + d.id + '">Reporte #' + d.id + "</a> · " + esc(d.leader) + " · " + esc(d.reason) + " · " + dBadge(d.status) + "</li>"; }).join("") + "</ul>" : "") + "</div>";
    });
  }

  function loadLeaders() {
    body().innerHTML = '<div class="card"><h3>Gestión de líderes de clan</h3><form class="pn-filter" id="lf-form"><input type="search" id="lf-q" data-sg="any" autocomplete="off" placeholder="Líder o clan" maxlength="40" value="' + esc(lf.q) + '"> <button type="submit">Buscar</button></form><div id="lf-list"><p class="help">Cargando…</p></div></div>';
    getJson("/api/admin/leaders?q=" + encodeURIComponent(lf.q)).then(function (j) {
      var el = document.getElementById("lf-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.leaders.length ? j.leaders.map(function (l) {
        return '<tr><td><a href="#panel/jugador/' + l.playerId + '">' + esc(l.alias) + "</a></td><td>" + ROLE_ES[l.role] + '</td><td><a href="#panel/clan/' + l.clanId + '">' + esc(l.clan) + "</a></td><td>" + (l.toConfirm ? '<span class="badge st-pending">' + l.toConfirm + " por confirmar</span>" : "—") + "</td><td>" + l.open + "</td><td>" + (l.active ? "Activa" : "Desactivada") + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="6">No hay líderes con ese filtro.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>Líder</th><th>Rango</th><th>Clan</th><th>Reportes que debe confirmar</th><th>Reportes abiertos</th><th>Cuenta</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">Aquí ves quién tiene reportes sin confirmar. Los <a href=\"#panel/disc\">reportes disciplinarios</a> son un seguimiento aparte y no sancionan por sí solos.</p>";
    });
  }

  /* ----- Historial ----- */
  function loadAudit() {
    body().innerHTML = '<div class="card"><h3>Historial de acciones administrativas</h3>' +
      '<form class="pn-filter" id="af-form"><input type="search" id="af-actor" data-sg="player" autocomplete="off" placeholder="Administrador" maxlength="40" value="' + esc(af.actor) + '"> <input type="text" id="af-action" placeholder="Tipo de acción (ej. partido_)" maxlength="60" value="' + esc(af.action) + '"> ' +
      '<input type="text" inputmode="numeric" id="af-player" data-sg="player-id" autocomplete="off" placeholder="ID jugador" min="1" value="' + esc(af.player) + '"> <input type="text" inputmode="numeric" id="af-clan" data-sg="clan-id" autocomplete="off" placeholder="ID clan" min="1" value="' + esc(af.clan) + '"> <input type="number" id="af-match" placeholder="ID partido" min="1" value="' + esc(af.match) + '"> ' +
      '<label>Desde <input type="date" id="af-from" value="' + esc(af.from) + '"></label> <label>Hasta <input type="date" id="af-to" value="' + esc(af.to) + '"></label> <button type="submit">Filtrar</button> <button type="button" class="linkbtn" id="af-clear">Limpiar</button></form>' +
      '<div id="af-list"><p class="help">Cargando…</p></div></div>';
    var qs = "?page=" + af.page + "&actor=" + encodeURIComponent(af.actor) + "&action=" + encodeURIComponent(af.action) + "&player=" + af.player + "&clan=" + af.clan + "&match=" + af.match + (af.from ? "&from=" + dayStart(af.from) : "") + (af.to ? "&to=" + dayEnd(af.to) : "");
    getJson("/api/admin/audit" + qs).then(function (j) {
      var el = document.getElementById("af-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.rows.length ? j.rows.map(function (r) {
        var tgt = r.type ? esc(r.type) + " #" + r.targetId : "—";
        if (r.matchId) tgt = '<a href="#panel/partido/' + r.matchId + '">partido #' + r.matchId + "</a>";
        return "<tr><td>" + fdt(r.at) + "</td><td>" + esc(r.actor) + "<br><small>" + esc(r.role) + "</small></td><td>" + esc(ACTIONS[r.action] || r.action) + "</td><td>" + tgt + "</td><td>" + esc(r.reason) + "</td><td>" + esc(r.result) + "</td><td>" + histCell(r) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="7">No hay registros con esos filtros.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Registro</th><th>Motivo</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">" + j.total + " registro(s). El historial no se puede editar ni borrar.</p>" + pager(j.page, j.total, j.per, "apage");
    });
  }

  /* ----- Configuración ----- */
  function loadConfig() {
    var html = '<div class="card" id="cfg-card"><h3>Plazos y reglas</h3><p class="help">Cargando…</p></div><div class="card"><h3>Temporadas</h3><p class="help">Crear, programar el cierre y cerrar temporadas (copas del Medal of Honor).</p><div class="pn-actions"><a class="btnlink" href="#admin">Abrir administración de temporadas</a></div></div>';
    if (!can("roles.manage")) {
      body().innerHTML = html + '<div class="card"><h3>Personal con permisos</h3><p class="help">Solo el superadministrador puede asignar roles.</p></div>';
      loadRules();
      return;
    }
    body().innerHTML = html + '<div class="card"><h3>Personal con permisos</h3><div id="st-list"><p class="help">Cargando…</p></div>' +
      '<form class="pn-form" id="st-form" novalidate><label>Nombre del jugador<input type="text" id="st-alias" maxlength="40" autocomplete="off"></label>' +
      '<label>Rol<select id="st-role"><option value="news">Encargado de noticias</option><option value="moderator">Moderador</option><option value="admin">Administrador</option><option value="superadmin">Superadministrador</option><option value="">Quitar permisos</option></select></label>' +
      '<label class="wide">Motivo (obligatorio)<input type="text" id="st-reason" maxlength="500"></label><div class="wide"><button type="submit">Aplicar rol</button></div></form>' +
      '<p class="help">Los alias definidos en ADMIN_ALIAS del servidor son superadministradores fijos. Nadie puede cambiarse su propio rol.</p></div>';
    loadRules();
    getJson("/api/admin/staff").then(function (j) {
      var el = document.getElementById("st-list"); if (!el) return;
      var rows = (j.staff || []).map(function (s) { return "<tr><td>" + esc(s.alias) + " (ID " + s.id + ")</td><td>" + esc({ news: "Encargado de noticias", moderator: "Moderador", admin: "Administrador", superadmin: "Superadministrador" }[s.role] || s.role) + "</td><td>" + (s.locked ? "Fijo (servidor)" : "") + "</td></tr>"; }).join("");
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>Jugador</th><th>Rol</th><th></th></tr></thead><tbody>' + (rows || '<tr><td class="none" colspan="3">Sin personal asignado.</td></tr>') + "</tbody></table></div>";
    });
    document.getElementById("st-form").addEventListener("submit", function (e) {
      e.preventDefault(); if (busy) return;
      var alias = document.getElementById("st-alias").value.trim(), role = document.getElementById("st-role").value, reason = document.getElementById("st-reason").value.trim();
      if (!alias) { say("Escribe el nombre del jugador.", "err"); return; }
      if (reason.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return; }
      dialog("¿Asignar el rol «" + (role || "sin permisos") + "» a " + alias + "?", { ok: "Aplicar" }).then(function (ok) {
        if (!ok) return; busy = true;
        post("/api/admin/staff/set", { alias: alias, role: role, reason: reason, confirm: true }).then(function (r) {
          busy = false; if (r.ok) { say("Rol actualizado.", "ok"); loadConfig(); } else say(r.error || "No se pudo cambiar.", "err");
        }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
      });
    });
  }

  function loadRules() {
    getJson("/api/admin/config").then(function (c) {
      var el = document.getElementById("cfg-card"); if (!el) return;
      if (c.status !== 200) { el.innerHTML = "<h3>Plazos y reglas</h3>"; return; }
      el.innerHTML = "<h3>Plazos y reglas</h3>" + (c.canEdit ? '<form class="pn-form" id="cfg-form" novalidate><label>Horas para que el clan ganador confirme antes de generar una alerta<input type="number" id="cfg-hours" min="1" max="720" value="' + c.unreportedHours + '"></label>' +
        '<label>Un partido en disputa<select id="cfg-dispute"><option value="loss"' + (c.disputeCounts === "loss" ? " selected" : "") + '>cuenta la derrota de quien reportó</option><option value="none"' + (c.disputeCounts === "none" ? " selected" : "") + ">no cuenta para nadie hasta resolverse</option></select></label>" +
        '<label class="wide">Motivo del cambio (obligatorio)<input type="text" id="cfg-reason" maxlength="500"></label><div class="wide"><button type="submit">Guardar</button></div></form>' : '<p class="help">Alerta tras ' + c.unreportedHours + " horas sin confirmar. Solo el administrador puede cambiar estas reglas.</p>");
    });
  }

  /* ----- Navegación ----- */

  /* ===== Parte 4: sanciones, denuncias, apelaciones y reportes a líderes ===== */
  var sf = { tab: "sanciones", status: "", type: "", q: "", page: 1 }, cmf = { status: "open", q: "", page: 1 }, df = { status: "open", page: 1 };
  var curS = null, curCm = null, curD = null, sKey = newKey(), cKey = newKey(), dKey = newKey();
  function sBadge(s) { return '<span class="badge st-' + (s === "active" ? "confirmed" : s === "revoked" ? "rejected" : "annulled") + '">' + esc(SSTATUS[s] || s) + "</span>"; }
  function cBadge(s) { return '<span class="badge st-' + (s === "confirmed" ? "rejected" : s === "rejected" || s === "closed" ? "annulled" : "pending") + '">' + esc(CSTATUS[s] || s) + "</span>"; }
  function dBadge(s) { return '<span class="badge st-' + (s === "resolved" || s === "closed" ? "confirmed" : "pending") + '">' + esc(DSTATUS[s] || s) + "</span>"; }
  function sLine(x) { return x.ends ? "hasta " + fdt(x.ends) : "sin vencimiento"; }
  function tabs(cur) {
    return '<div class="pn-tabs">' + [["sanciones", "Sanciones"], ["denuncias", "Denuncias"], ["apelaciones", "Apelaciones"]].map(function (t) { return '<button type="button" class="linkbtn' + (cur === t[0] ? " on" : "") + '" data-stab="' + t[0] + '">' + t[1] + "</button>"; }).join(" ") + "</div>";
  }
  function sanctionRows(list, withTarget) {
    return list.length ? list.map(function (x) {
      var tgt = x.targetType === "clan" ? '<a href="#panel/clan/' + x.clanId + '">' + esc(x.target || "Clan #" + x.clanId) + "</a> (clan)" : '<a href="#panel/jugador/' + x.playerId + '">' + esc(x.target || "Jugador #" + x.playerId) + "</a>";
      return '<tr><td><a href="#panel/sancion/' + x.id + '">#' + x.id + "</a></td>" + (withTarget ? "<td>" + tgt + "</td>" : "") + "<td>" + esc(x.typeLabel) + "</td><td>" + esc(x.reason || "") + "</td><td>" + esc(SEV[x.severity] || x.severity) + "</td><td>" + sBadge(x.status) + (x.appealStatus === "pending" ? ' <span class="badge st-disputed">Apelación</span>' : "") + "</td><td>" + fdt(x.startsAt) + "<br><small>" + (x.endsAt ? "hasta " + fdt(x.endsAt) : "sin vencimiento") + "</small></td></tr>";
    }).join("") : '<tr><td class="none" colspan="' + (withTarget ? 7 : 6) + '">Sin sanciones.</td></tr>';
  }
  function loadSanciones() {
    var head = '<div class="card"><h3>Sanciones y disciplina</h3>' + tabs(sf.tab);
    if (sf.tab === "denuncias") {
      body().innerHTML = head + '<form class="pn-filter" id="cmf-form"><select id="cmf-status"><option value="open"' + (cmf.status === "open" ? " selected" : "") + '>Abiertas</option><option value=""' + (cmf.status === "" ? " selected" : "") + ">Todas</option>" + Object.keys(CSTATUS).map(function (k) { return '<option value="' + k + '"' + (cmf.status === k ? " selected" : "") + ">" + CSTATUS[k] + "</option>"; }).join("") + '</select> <input type="search" id="cmf-q" data-sg="player" autocomplete="off" placeholder="Nick del jugador" maxlength="40" value="' + esc(cmf.q) + '"> <button type="submit">Buscar</button>' + (can("complaints.manage") ? ' <button type="button" id="cm-new">Registrar denuncia</button>' : "") + '</form><div id="s-list"><p class="help">Cargando…</p></div></div>';
      getJson("/api/admin/complaints?page=" + cmf.page + "&status=" + cmf.status + "&q=" + encodeURIComponent(cmf.q)).then(function (j) {
        var el = document.getElementById("s-list"); if (!el) return;
        if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
        var rows = j.complaints.length ? j.complaints.map(function (c) { return '<tr><td><a href="#panel/denuncia/' + c.id + '">#' + c.id + '</a></td><td><a href="#panel/jugador/' + c.accusedId + '">' + esc(c.accused) + "</a></td><td>" + esc(c.accuser) + "</td><td>" + (c.matchId ? '<a href="#panel/partido/' + c.matchId + '">#' + c.matchId + "</a>" : "—") + "</td><td>" + cBadge(c.status) + "</td><td>" + fdt(c.createdAt) + "</td></tr>"; }).join("") : '<tr><td class="none" colspan="6">No hay denuncias con ese filtro.</td></tr>';
        el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Denunciado</th><th>Denunciante</th><th>Partido</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">Una denuncia no es una prueba de culpabilidad: solo se sanciona tras revisar las evidencias. " + j.total + " denuncia(s).</p>" + pager(j.page, j.total, j.per, "cmpage");
      });
      return;
    }
    var appeals = sf.tab === "apelaciones";
    body().innerHTML = head + '<form class="pn-filter" id="sf-form">' + (appeals ? "" : '<select id="sf-status"><option value="">Todas</option><option value="active"' + (sf.status === "active" ? " selected" : "") + '>Vigentes</option><option value="expired"' + (sf.status === "expired" ? " selected" : "") + '>Expiradas</option><option value="revoked"' + (sf.status === "revoked" ? " selected" : "") + '>Revocadas</option></select> <select id="sf-type"><option value="">Todos los tipos</option>' + Object.keys(TYPES).map(function (k) { return '<option value="' + k + '"' + (sf.type === k ? " selected" : "") + ">" + TYPES[k] + "</option>"; }).join("") + "</select> ") +
      '<input type="search" id="sf-q" data-sg="any" autocomplete="off" placeholder="Jugador o clan" maxlength="40" value="' + esc(sf.q) + '"> <button type="submit">Buscar</button></form><div id="s-list"><p class="help">Cargando…</p></div></div>';
    getJson("/api/admin/sanctions?page=" + sf.page + "&status=" + (appeals ? "appeal" : sf.status) + "&type=" + (appeals ? "" : sf.type) + "&q=" + encodeURIComponent(sf.q)).then(function (j) {
      var el = document.getElementById("s-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Sancionado</th><th>Tipo</th><th>Motivo</th><th>Gravedad</th><th>Estado</th><th>Vigencia</th></tr></thead><tbody>' + sanctionRows(j.sanctions, true) + "</tbody></table></div><p class=\"help\">" + j.total + " sanción(es). Para sancionar abre la ficha del jugador o del clan y usa «Aplicar sanción».</p>" + pager(j.page, j.total, j.per, "spage");
    });
  }
  var TYPES = { warning: "Advertencia", reprimand: "Amonestación", point_loss: "Pérdida de puntos", result_annulment: "Anulación de resultado", ladder_suspension: "Suspensión temporal de la Ladder", tournament_suspension: "Suspensión de torneo", temp_disqualification: "Descalificación temporal", expulsion: "Expulsión del clan o de la Ladder", permanent_ban: "Baneo permanente" };

  function evBlock(type, id, list, canAdd, canHide) {
    var rows = list.length ? list.map(function (e) {
      return "<li>" + (e.kind === "link" ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.label) + "</a>" : '<a href="' + esc(e.url) + '" target="_blank" rel="noopener"><img class="pn-thumb" src="' + esc(e.url) + '" alt="' + esc(e.label) + '"></a>') + " <small>· " + esc(e.by) + " · " + fdt(e.at) + "</small>" + (e.hidden ? ' <span class="badge st-annulled">Oculta</span>' : "") +
        (canHide ? ' <button type="button" class="linkbtn" data-evhide="' + e.id + '" data-hide="' + (e.hidden ? 0 : 1) + '">' + (e.hidden ? "Mostrar" : "Ocultar") + "</button>" : "") + "</li>";
    }).join("") : '<li class="none">Sin evidencias.</li>';
    return '<div class="card"><h3>Evidencias</h3><ul class="pn-ev">' + rows + "</ul>" + (canAdd ? '<form class="pn-form" id="gev-form" data-type="' + type + '" data-id="' + id + '" novalidate><label>Enlace<input type="text" id="gev-url" maxlength="300" placeholder="https://…"></label><label>Descripción<input type="text" id="gev-label" maxlength="80"></label><div class="wide"><button type="submit">Agregar enlace</button> <label class="pn-inline">o subir captura <input type="file" id="gev-file" accept="image/png,image/jpeg,image/webp,image/gif"></label></div></form><p class="help">Las evidencias de denuncias y sanciones solo las ve el equipo autorizado.</p>' : "") + "</div>";
  }
  function noteBlock(type, id, notes, canNote) {
    return canNote ? '<div class="card"><h3>Notas privadas</h3><ul class="pn-ev">' + notesHtml(notes) + '</ul><form class="pn-form" id="pnote-form" data-type="' + type + '" data-id="' + id + '" novalidate><label class="wide">Nueva nota<textarea id="pnote-text" maxlength="1000" rows="2"></textarea></label><div class="wide"><button type="submit">Guardar nota</button></div></form></div>' : "";
  }
  function auditCard(h) {
    return '<div class="card"><h3>Historial</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Motivo</th><th>Detalle</th></tr></thead><tbody>' + histRows(h) + "</tbody></table></div></div>";
  }

  function loadSancion(id) {
    body().innerHTML = '<div class="card"><h3>Sanción</h3><p class="help">Cargando…</p></div>';
    getJson("/api/admin/sanction?id=" + encodeURIComponent(id)).then(function (j) {
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Sanción</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + '</p><p><a href="#panel/sanciones">Volver</a></p></div>'; return; }
      curS = j; var x = j.sanction;
      var tgt = x.targetType === "clan" ? '<a href="#panel/clan/' + x.clanId + '">' + esc(x.target) + "</a> (clan)" : '<a href="#panel/jugador/' + x.playerId + '">' + esc(x.target) + "</a>";
      var acts = "";
      if (x.status === "active" && j.canRevoke) acts += '<button type="button" data-sact="revoke">Levantar sanción</button> ';
      if (x.status === "active" && j.canEdit) acts += '<form class="pn-form" id="s-edit" novalidate><label>Nueva duración (días)<input type="number" id="s-days" min="1" max="365"></label><div><button type="submit">Modificar duración</button></div></form>';
      var appeal = x.appealStatus ? '<div class="card"><h3>Apelación</h3><p>' + esc(x.appealText) + "</p><p><small>" + fdt(x.appealAt) + "</small></p><p>Estado: <b>" + ({ pending: "Pendiente", accepted: "Aceptada", rejected: "Rechazada" }[x.appealStatus] || esc(x.appealStatus)) + "</b></p>" + (x.appealResolution ? "<p><b>Resolución:</b> " + esc(x.appealResolution) + "</p>" : "") +
        (x.appealStatus === "pending" && j.canResolve ? '<form class="pn-form" id="s-appeal" novalidate><label>Decisión<select id="sa-dec"><option value="accepted">Aceptar (levanta la sanción)</option><option value="rejected">Rechazar</option></select></label><label class="wide">Resolución (visible para el sancionado)<textarea id="sa-res" maxlength="1000" rows="2"></textarea></label><div class="wide"><button type="submit">Resolver apelación</button></div></form>' : "") + "</div>" : "";
      body().innerHTML = '<p><a href="#panel/sanciones">« Volver a sanciones</a></p><div class="card"><h3>Sanción #' + x.id + " " + sBadge(x.status) + '</h3><table class="dtable kv"><tr><td>Sancionado</td><td>' + tgt + "</td></tr><tr><td>Tipo</td><td>" + esc(x.typeLabel) + "</td></tr><tr><td>Motivo</td><td>" + esc(x.reason) + "</td></tr><tr><td>Gravedad</td><td>" + esc(SEV[x.severity] || x.severity) + "</td></tr><tr><td>Descripción</td><td>" + esc(x.description) + "</td></tr>" +
        (x.rules ? "<tr><td>Reglas infringidas</td><td>" + esc(x.rules) + "</td></tr>" : "") + "<tr><td>Inicio</td><td>" + fdt(x.startsAt) + "</td></tr><tr><td>Fin</td><td>" + (x.endsAt ? fdt(x.endsAt) : "Sin vencimiento") + "</td></tr>" + (x.pts ? "<tr><td>Victorias quitadas</td><td>" + x.pts + "</td></tr>" : "") +
        (x.matchId ? '<tr><td>Partido</td><td><a href="#panel/partido/' + x.matchId + '">#' + x.matchId + "</a></td></tr>" : "") + (x.complaintId ? '<tr><td>Denuncia</td><td><a href="#panel/denuncia/' + x.complaintId + '">#' + x.complaintId + "</a></td></tr>" : "") + "<tr><td>Aplicada por</td><td>" + esc(x.by) + " · " + fdt(x.createdAt) + "</td></tr><tr><td>Apelable</td><td>" + (x.appealable ? "Sí" : "No") + "</td></tr></table><div class=\"pn-actions\">" + acts + "</div></div>" + appeal +
        evBlock("sanction", x.id, j.evidence, j.canEvidence, j.canEvidence) + noteBlock("sanction", x.id, j.notes, j.canNote) +
        '<div class="card"><h3>Historial de la sanción</h3><div class="scroll"><table class="dtable"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Antes</th><th>Después</th><th>Motivo</th></tr></thead><tbody>' + (j.history.length ? j.history.map(function (h) { return "<tr><td>" + fdt(h.at) + "</td><td>" + esc(h.actor) + "</td><td>" + esc(ACTIONS[h.action] || h.action) + "</td><td><small>" + esc(h.old || "—") + "</small></td><td><small>" + esc(h.new || "—") + "</small></td><td>" + esc(h.reason) + "</td></tr>"; }).join("") : '<tr><td class="none" colspan="6">Sin movimientos.</td></tr>') + "</tbody></table></div></div>";
    });
  }

  var newS = null;
  function newSanction(kind, tid) {
    body().innerHTML = '<div class="card"><h3>Aplicar sanción</h3><p class="help">Cargando…</p></div>';
    var targetUrl = kind === "clan" ? "/api/admin/clan?id=" : "/api/admin/player?id=";
    Promise.all([getJson("/api/admin/reasons"), getJson(targetUrl + encodeURIComponent(tid)), getJson("/api/admin/complaints?status=confirmed" + (kind === "player" ? "&q=" : "&q=zzzz_none"))]).then(function (rs) {
      var rj = rs[0], tj = rs[1];
      if (rj.status !== 200 || tj.status !== 200) { body().innerHTML = '<div class="card"><h3>Aplicar sanción</h3><p class="help">' + esc(rj.error || tj.error || "No se pudo cargar.") + "</p></div>"; return; }
      var name = kind === "clan" ? tj.clan.name : tj.player.alias;
      newS = { kind: kind, id: Number(tid), name: name };
      var types = rj.types.filter(function (t) { return !t.restricted && (t.light ? rj.canWarn : rj.canApply); }).filter(function (t) { return kind === "player" || t.code !== "expulsion" || true; });
      var comps = ((kind === "player" ? (tj.complaints || []) : []).filter(function (c) { return c.role === "denunciado" && c.status === "confirmed"; }));
      body().innerHTML = '<p><a href="#panel/' + (kind === "clan" ? "clan" : "jugador") + "/" + tid + '">« Volver a la ficha</a></p><div class="card"><h3>Aplicar sanción a ' + esc(name) + (kind === "clan" ? " (clan)" : "") + '</h3><form class="pn-form" id="ns-form" novalidate>' +
        '<label>Tipo de sanción<select id="ns-type">' + types.map(function (t) { return '<option value="' + t.code + '" data-dur="' + (t.needsDuration ? 1 : 0) + '">' + esc(t.label) + "</option>"; }).join("") + (info.role === "superadmin" ? '<option value="permanent_ban" data-dur="0">Baneo permanente</option>' : "") + "</select></label>" +
        '<label>Motivo<select id="ns-reason">' + rj.reasons.filter(function (r) { return r.active; }).map(function (r) { return '<option value="' + r.code + '">' + esc(r.label) + "</option>"; }).join("") + "</select></label>" +
        '<label>Gravedad<select id="ns-sev"><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="grave">Grave</option></select></label>' +
        '<label>Duración (días)<input type="number" id="ns-days" min="1" max="365" placeholder="Solo si aplica"></label><label>Victorias a quitar<input type="number" id="ns-pts" min="1" max="20" placeholder="Solo pérdida de puntos"></label><label>ID del partido<input type="number" id="ns-match" min="1" placeholder="Opcional (obligatorio al anular)"></label>' +
        '<label>Denuncia confirmada vinculada<select id="ns-cmp"><option value="">Ninguna</option>' + comps.map(function (c) { return '<option value="' + c.id + '">Denuncia #' + c.id + "</option>"; }).join("") + "</select></label>" +
        '<label class="wide">Descripción de la infracción<textarea id="ns-desc" maxlength="1000" rows="3"></textarea></label><label class="wide">Reglas infringidas (opcional)<input type="text" id="ns-rules" maxlength="300"></label>' +
        '<label><input type="checkbox" id="ns-appeal" checked> Permitir apelación</label><div class="wide"><button type="submit">Aplicar sanción</button></div></form>' +
        '<p class="help">Los motivos de trampas o programas prohibidos exigen una denuncia con la infracción confirmada. La sanción queda en el historial, se puede revocar y nunca borra partidos ni estadísticas. El jugador la verá en «Manejo de cuenta» con el motivo y cómo apelar.</p></div>';
    });
  }
  function submitSanction() {
    var v = function (x) { return document.getElementById(x).value; };
    var type = v("ns-type");
    var data = { targetType: newS.kind, targetId: newS.id, type: type, reasonCode: v("ns-reason"), severity: v("ns-sev"), description: v("ns-desc").trim(), rules: v("ns-rules").trim(), days: Number(v("ns-days")) || 0, points: Number(v("ns-pts")) || 0, matchId: Number(v("ns-match")) || 0, complaintId: Number(v("ns-cmp")) || 0, appealable: document.getElementById("ns-appeal").checked, key: sKey };
    if (data.description.length < 10) { say("Describe la infracción (al menos 10 caracteres).", "err"); return; }
    var go = function (conf) {
      if (busy) return; busy = true;
      if (conf) data.confirmText = conf;
      post("/api/admin/sanction/create", data).then(function (r) { busy = false; if (r.ok) { sKey = newKey(); location.hash = "#panel/sancion/" + r.id; } else say(r.error || "No se pudo aplicar.", "err"); })
        .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
    };
    if (type === "permanent_ban") dialog("El baneo permanente impide a " + newS.name + " competir para siempre (se puede revocar después). Escribe BANEAR para confirmar.", { input: "BANEAR", ok: "Aplicar baneo" }).then(function (t) { if (t) go(t); });
    else dialog("Se aplicará «" + document.getElementById("ns-type").selectedOptions[0].textContent + "» a " + newS.name + ". Quedará registrada y visible para el sancionado.", { ok: "Aplicar" }).then(function (ok) { if (ok) go(); });
  }

  function loadDenuncia(id) {
    body().innerHTML = '<div class="card"><h3>Denuncia</h3><p class="help">Cargando…</p></div>';
    getJson("/api/admin/complaint?id=" + encodeURIComponent(id)).then(function (j) {
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Denuncia</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + '</p><p><a href="#panel/sanciones">Volver</a></p></div>'; return; }
      curCm = j; var c = j.complaint;
      var opts = Object.keys(CSTATUS).filter(function (k) { return j.canResolve || ["received", "pending", "investigating", "insufficient"].indexOf(k) >= 0; }).map(function (k) { return '<option value="' + k + '"' + (c.status === k ? " selected" : "") + ">" + CSTATUS[k] + "</option>"; }).join("");
      body().innerHTML = '<p><a href="#panel/sanciones">« Volver</a></p><div class="card"><h3>Denuncia #' + c.id + " " + cBadge(c.status) + '</h3><p class="help">Una denuncia no es una prueba de culpabilidad. Revisa las evidencias antes de decidir.</p><table class="dtable kv"><tr><td>Denunciado</td><td><a href="#panel/jugador/' + c.accusedId + '">' + esc(c.accused) + "</a></td></tr><tr><td>Denunciante</td><td>" + (c.accuserId ? '<a href="#panel/jugador/' + c.accuserId + '">' + esc(c.accuser) + "</a>" : esc(c.accuser)) + "</td></tr>" +
        (c.matchId ? '<tr><td>Partido</td><td><a href="#panel/partido/' + c.matchId + '">#' + c.matchId + "</a></td></tr>" : "") + (c.incidentAt ? "<tr><td>Fecha del incidente</td><td>" + fdt(c.incidentAt) + "</td></tr>" : "") + (c.serverIp ? "<tr><td>IP del servidor</td><td>" + esc(c.serverIp) + "</td></tr>" : "") + "<tr><td>Recibida</td><td>" + fdt(c.createdAt) + "</td></tr><tr><td>Descripción</td><td>" + esc(c.description) + "</td></tr>" + (c.resolution ? "<tr><td>Resolución</td><td>" + esc(c.resolution) + "</td></tr>" : "") +
        (c.sanctionId ? '<tr><td>Sanción aplicada</td><td><a href="#panel/sancion/' + c.sanctionId + '">#' + c.sanctionId + "</a></td></tr>" : "") + "</table>" +
        (c.status === "confirmed" && !c.sanctionId && j.canSanction ? '<p><a class="btnlink" href="#panel/sancion-nueva/player/' + c.accusedId + '">Aplicar sanción a ' + esc(c.accused) + "</a> (elige esta denuncia en el formulario)</p>" : "") + "</div>" +
        '<div class="card"><h3>Cambiar estado</h3><form class="pn-form" id="cm-form" novalidate><label>Estado<select id="cm-status">' + opts + '</select></label><label class="wide">Resolución (obligatoria al cerrar el análisis)<textarea id="cm-res" maxlength="1000" rows="2"></textarea></label><label class="wide">Motivo del cambio<input type="text" id="cm-reason" maxlength="300"></label><div class="wide"><button type="submit">Guardar</button></div></form></div>' +
        evBlock("complaint", c.id, j.evidence, true, true) + noteBlock("complaint", c.id, j.notes, true) + auditCard(j.history);
    });
  }
  function newComplaint() {
    body().innerHTML = '<p><a href="#panel/sanciones">« Volver</a></p><div class="card"><h3>Registrar denuncia</h3><form class="pn-form" id="cn-form" novalidate><label>Jugador denunciado (nick)<input type="text" id="cn-acc" data-sg="player" autocomplete="off" maxlength="40"></label><label>Denunciante (nick, opcional)<input type="text" id="cn-by" data-sg="player" autocomplete="off" maxlength="40"></label><label>ID del partido (opcional)<input type="number" id="cn-match" min="1"></label><label class="wide">Descripción de lo ocurrido<textarea id="cn-desc" maxlength="2000" rows="4"></textarea></label><div class="wide"><button type="submit">Registrar</button></div></form></div>';
  }

  /* ----- Reportes disciplinarios a líderes ----- */
  function loadDiscs() {
    body().innerHTML = '<div class="card"><h3>Reportes disciplinarios a líderes</h3><p><a href="#panel/lideres">« Volver a líderes</a></p><form class="pn-filter" id="df-form"><select id="df-status"><option value="open"' + (df.status === "open" ? " selected" : "") + '>Abiertos</option><option value=""' + (df.status === "" ? " selected" : "") + ">Todos</option>" + Object.keys(DSTATUS).map(function (k) { return '<option value="' + k + '"' + (df.status === k ? " selected" : "") + ">" + DSTATUS[k] + "</option>"; }).join("") + '</select> <button type="submit">Filtrar</button>' + (can("disc.manage") ? ' <a class="btnlink" href="#panel/disc-nuevo">Nuevo reporte</a>' : "") + '</form><div id="d-list"><p class="help">Cargando…</p></div></div>';
    getJson("/api/admin/discs?page=" + df.page + "&status=" + df.status).then(function (j) {
      var el = document.getElementById("d-list"); if (!el) return;
      if (j.status !== 200) { el.innerHTML = '<p class="help">' + esc(j.error || "No se pudo cargar.") + "</p>"; return; }
      var rows = j.discs.length ? j.discs.map(function (d) { return '<tr><td><a href="#panel/disc/' + d.id + '">#' + d.id + '</a></td><td><a href="#panel/clan/' + d.clanId + '">' + esc(d.clan) + '</a></td><td><a href="#panel/jugador/' + d.leaderId + '">' + esc(d.leader) + "</a></td><td>" + esc(d.reason) + "</td><td>" + esc(SEV[d.severity] || d.severity) + "</td><td>" + dBadge(d.status) + (d.overdue ? ' <span class="badge st-rejected">Plazo vencido</span>' : "") + "</td><td>" + (d.deadlineAt ? fdt(d.deadlineAt) : "—") + "</td></tr>"; }).join("") : '<tr><td class="none" colspan="7">No hay reportes con ese filtro.</td></tr>';
      el.innerHTML = '<div class="scroll"><table class="dtable"><thead><tr><th>ID</th><th>Clan</th><th>Líder</th><th>Motivo</th><th>Gravedad</th><th>Estado</th><th>Plazo</th></tr></thead><tbody>' + rows + "</tbody></table></div><p class=\"help\">" + j.total + " reporte(s). Un reporte no sanciona por sí solo: es una gestión de seguimiento.</p>" + pager(j.page, j.total, j.per, "dpage");
    });
  }
  function newDisc(clanId, matchId) {
    body().innerHTML = '<div class="card"><h3>Nuevo reporte disciplinario</h3><p class="help">Cargando…</p></div>';
    var p = clanId ? getJson("/api/admin/clan?id=" + clanId) : Promise.resolve(null);
    Promise.all([getJson("/api/admin/clanlist"), p]).then(function (rs) {
      var clans = rs[0].clans || [], cj = rs[1];
      var leaders = cj && cj.members ? cj.members.filter(function (m) { return m.role === "leader" || m.role === "coleader"; }) : [];
      body().innerHTML = '<p><a href="#panel/lideres">« Volver</a></p><div class="card"><h3>Nuevo reporte disciplinario</h3><form class="pn-form" id="dn-form" novalidate><label>Clan<select id="dn-clan">' + (clanId ? "" : '<option value="">Elige un clan</option>') + clans.map(function (c) { return '<option value="' + c.id + '"' + (Number(clanId) === c.id ? " selected" : "") + ">" + esc(c.name) + "</option>"; }).join("") + '</select></label>' +
        '<label>Líder responsable<select id="dn-leader">' + (leaders.length ? leaders.map(function (m) { return '<option value="' + m.id + '">' + esc(m.alias) + " (" + ROLE_ES[m.role] + ")</option>"; }).join("") : '<option value="">Elige primero el clan</option>') + "</select></label>" +
        '<label>Partido relacionado (ID)<input type="number" id="dn-match" min="1" value="' + (matchId ? esc(matchId) : "") + '"></label><label>Gravedad<select id="dn-sev"><option value="leve">Leve</option><option value="moderada">Moderada</option><option value="grave">Grave</option></select></label><label>Plazo de respuesta (días)<input type="number" id="dn-days" min="1" max="30" value="7"></label>' +
        '<label class="wide">Motivo del incumplimiento<input type="text" id="dn-reason" maxlength="200" placeholder="Ej. No reportó un partido jugado"></label><label class="wide">Descripción<textarea id="dn-desc" maxlength="1500" rows="3"></textarea></label><div class="wide"><button type="submit">Crear reporte</button></div></form><p class="help">Crear el reporte no sanciona ni notifica automáticamente: queda «Pendiente» hasta que lo notifiques al líder.</p></div>';
    });
  }
  function loadDisc(id) {
    body().innerHTML = '<div class="card"><h3>Reporte disciplinario</h3><p class="help">Cargando…</p></div>';
    getJson("/api/admin/disc?id=" + encodeURIComponent(id)).then(function (j) {
      if (j.status !== 200) { body().innerHTML = '<div class="card"><h3>Reporte</h3><p class="help">' + esc(j.error || "No se pudo cargar.") + '</p><p><a href="#panel/lideres">Volver</a></p></div>'; return; }
      curD = j; var d = j.disc, a = "";
      if (j.canManage) {
        if (d.status === "pending") a += '<button type="button" data-dact="notify">Notificar al líder</button> ';
        if (d.status === "pending" || d.status === "notified") a += '<button type="button" data-dact="review">Pasar a revisión</button> ';
        if (d.status !== "resolved" && d.status !== "closed") a += '<form class="pn-form" id="d-res" novalidate><label class="wide">Resolución<textarea id="dr-res" maxlength="1500" rows="2"></textarea></label><label class="wide">Medidas adoptadas<input type="text" id="dr-meas" maxlength="500"></label><div class="wide"><button type="submit">Resolver reporte</button></div></form>';
        if (d.status === "resolved") a += '<button type="button" data-dact="close">Cerrar reporte</button>';
      }
      body().innerHTML = '<p><a href="#panel/lideres">« Volver a líderes</a> · <a href="#panel/disc">Todos los reportes</a></p><div class="card"><h3>Reporte disciplinario #' + d.id + " " + dBadge(d.status) + '</h3><table class="dtable kv"><tr><td>Clan</td><td><a href="#panel/clan/' + d.clanId + '">' + esc(d.clan) + "</a></td></tr><tr><td>Líder</td><td><a href=\"#panel/jugador/" + d.leaderId + '">' + esc(d.leader) + "</a></td></tr>" + (d.matchId ? '<tr><td>Partido</td><td><a href="#panel/partido/' + d.matchId + '">#' + d.matchId + "</a></td></tr>" : "") +
        "<tr><td>Motivo</td><td>" + esc(d.reason) + "</td></tr><tr><td>Descripción</td><td>" + esc(d.description) + "</td></tr><tr><td>Gravedad</td><td>" + esc(SEV[d.severity] || d.severity) + "</td></tr><tr><td>Creado</td><td>" + fdt(d.createdAt) + " · " + esc(d.by) + "</td></tr><tr><td>Notificado</td><td>" + (d.notifiedAt ? fdt(d.notifiedAt) : "No") + "</td></tr><tr><td>Plazo de respuesta</td><td>" + fdt(d.deadlineAt) + "</td></tr>" +
        "<tr><td>Respuesta del líder</td><td>" + (d.response ? esc(d.response) + " <small>" + fdt(d.respondedAt) + "</small>" : "Sin respuesta") + "</td></tr>" + (d.resolution ? "<tr><td>Resolución</td><td>" + esc(d.resolution) + "</td></tr><tr><td>Medidas</td><td>" + esc(d.measures || "—") + "</td></tr>" : "") + '</table><div class="pn-actions">' + a + '</div><p class="help"><a href="#panel/sancion-nueva/player/' + d.leaderId + '">Aplicar una sanción al líder</a> es una decisión aparte y requiere su propio motivo.</p></div>' +
        evBlock("disc", d.id, j.evidence, j.canEvidence, j.canEvidence) + noteBlock("disc", d.id, j.notes, j.canNote) + auditCard(j.history);
    });
  }
  function discAction(a) {
    var t = { notify: "El líder verá este reporte en «Manejo de cuenta» y podrá responder.", review: "El reporte pasa a revisión.", close: "Se cierra el reporte." }[a];
    act(t, "/api/admin/disc/update", { id: curD.disc.id, action: a }, "Reporte actualizado.", function () { loadDisc(curD.disc.id); });
  }
  function sanctionAction(a) {
    act("Se levantará la sanción. Si quitó victorias o anuló un resultado, se restituyen.", "/api/admin/sanction/revoke", { id: curS.sanction.id }, "Sanción levantada.", function () { loadSancion(curS.sanction.id); });
  }
  // Evidencia genérica (denuncias, sanciones, reportes).
  function gevAdd(form) {
    var type = form.getAttribute("data-type"), id = Number(form.getAttribute("data-id")); if (busy) return; busy = true;
    post("/api/admin/evidence/link", { ownerType: type, id: id, url: document.getElementById("gev-url").value.trim(), label: document.getElementById("gev-label").value.trim() })
      .then(function (r) { busy = false; if (r.ok) { say("Enlace agregado.", "ok"); reloadOwner(type, id); } else say(r.error || "No se pudo agregar.", "err"); }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }
  function reloadOwner(type, id) { if (type === "complaint") loadDenuncia(id); else if (type === "disc") loadDisc(id); else loadSancion(id); }
  function curOwner() { var f = document.getElementById("gev-form"); return f ? { type: f.getAttribute("data-type"), id: Number(f.getAttribute("data-id")) } : null; }
  function stBlock(list, clanFicha) { return ""; }


  /* ----- Sugerencias al escribir: lista desplegable de jugadores y clanes ----- */
  var sgClans = null, sgTimer = null;
  function sgFill(inp, items) {
    var id = "dl-" + inp.id, dl = document.getElementById(id);
    if (!dl) { dl = document.createElement("datalist"); dl.id = id; inp.parentNode.appendChild(dl); inp.setAttribute("list", id); }
    dl.innerHTML = items.slice(0, 25).map(function (x) { return '<option value="' + esc(x.v) + '"' + (x.l ? ' label="' + esc(x.l) + '"' : "") + "></option>"; }).join("");
  }
  function sgClanList() {
    if (sgClans) return Promise.resolve(sgClans);
    return getJson("/api/admin/clanlist").then(function (j) { sgClans = j.status === 200 ? (j.clans || []) : []; return sgClans; });
  }
  function suggest(inp) {
    var kind = inp.getAttribute("data-sg"), term = inp.value.trim().toLowerCase();
    if (kind.indexOf("-id") > 0 && /^\d+$/.test(term)) term = "";
    var wantP = kind === "any" || kind.indexOf("player") === 0, wantC = kind === "any" || kind.indexOf("clan") === 0;
    var ps = wantP ? getJson("/api/players?q=" + encodeURIComponent(term)).then(function (j) { return (j.players || []).map(function (p) { return { v: kind === "player-id" ? String(p.id) : p.alias, l: kind === "player-id" ? p.alias : "Jugador" }; }); }) : Promise.resolve([]);
    var cs = wantC ? sgClanList().then(function (l) { return l.filter(function (c) { return !term || c.name.toLowerCase().indexOf(term) >= 0; }).map(function (c) { return { v: kind === "clan-id" ? String(c.id) : c.name, l: kind === "clan-id" ? c.name : "Clan" }; }); }).catch(function () { return []; }) : Promise.resolve([]);
    Promise.all([cs, ps]).then(function (r) { if (document.body.contains(inp)) sgFill(inp, r[0].concat(r[1])); });
  }
  function sgEvent(e) {
    var t = e.target; if (!t || !t.getAttribute || !t.getAttribute("data-sg")) return;
    clearTimeout(sgTimer); sgTimer = setTimeout(function () { suggest(t); }, e.type === "focusin" ? 0 : 200);
  }
  function openCal(e) {
    var t = e.target; if (!t || t.id !== "mc-date") return;
    try { if (t.showPicker) t.showPicker(); } catch (x) {}
  }
  root.addEventListener("click", openCal);
  if (noticesBox) noticesBox.addEventListener("click", openCal);
  var ccTimer = null;
  function fillAccusedClan(inp) {
    var out = document.getElementById("mc-clan"); if (!out) return;
    var nick = inp.value.trim(); if (!nick) { out.value = ""; return; }
    getJson("/api/players?q=" + encodeURIComponent(nick)).then(function (j) {
      if (inp.value.trim() !== nick) return;
      var p = (j.players || []).filter(function (x) { return x.alias.toLowerCase() === nick.toLowerCase(); })[0];
      out.value = p ? (p.clan || "Sin clan") : "";
    });
  }
  function ccEvent(e) {
    var t = e.target; if (!t || t.id !== "mc-acc") return;
    clearTimeout(ccTimer); ccTimer = setTimeout(function () { fillAccusedClan(t); }, 200);
  }
  root.addEventListener("input", ccEvent); root.addEventListener("change", ccEvent);
  if (noticesBox) { noticesBox.addEventListener("input", ccEvent); noticesBox.addEventListener("change", ccEvent); }
  root.addEventListener("focusin", sgEvent); root.addEventListener("input", sgEvent);
  if (noticesBox) { noticesBox.addEventListener("focusin", sgEvent); noticesBox.addEventListener("input", sgEvent); }

  function render(parts) {
    var sec = parts[1] || "resumen";
    section = sec;
    shell();
    say("");
    if (sec === "resumen") loadResumen();
    else if (sec === "partidos") { lastSection = "partidos"; if (parts[2] === "nuevo") newMatchForm(); else loadMatches(); }
    else if (sec === "jugadores") loadPlayers();
    else if (sec === "jugador") loadPlayer(parts[2]);
    else if (sec === "clanes") loadClans();
    else if (sec === "clan") loadClan(parts[2]);
    else if (sec === "lideres") loadLeaders();
    else if (sec === "reportes") { lastSection = "reportes"; loadReports(); }
    else if (sec === "partido") loadMatch(parts[2]);
    else if (sec === "sanciones") loadSanciones();
    else if (sec === "sancion") loadSancion(parts[2]);
    else if (sec === "sancion-nueva") newSanction(parts[2] === "clan" ? "clan" : "player", parts[3]);
    else if (sec === "denuncia") { if (parts[2] === "nueva") newComplaint(); else loadDenuncia(parts[2]); }
    else if (sec === "disc") { if (parts[2]) loadDisc(parts[2]); else loadDiscs(); }
    else if (sec === "disc-nuevo") newDisc(parts[2], parts[3]);
    else if (sec === "historial") loadAudit();
    else if (sec === "config") loadConfig();
    else { location.hash = "#panel/resumen"; }
  }
  window.LadderPanel = {
    open: function (parts) {
      root.innerHTML = '<div class="card"><h3>Administración Ladder</h3><p class="help">Cargando…</p></div>';
      getJson("/api/admin/me").then(function (j) {
        if (j.status !== 200) { info = null; root.innerHTML = '<div class="card"><h3>Administración Ladder</h3><p class="help">' + (j.status === 401 ? "Inicia sesión para continuar." : "Esta sección es solo para el equipo de administración.") + "</p></div>"; return; }
        info = j; render(parts);
      }).catch(function () { root.innerHTML = '<div class="card"><h3>Administración Ladder</h3><p class="help">No se pudo cargar.</p></div>'; });
    }
  };

  root.addEventListener("click", function (e) {
    var b = e.target.closest("button, a");
    if (!b) return;
    if (b.hasAttribute("data-mpage")) { mf.page = Number(b.getAttribute("data-mpage")); loadMatches(); }
    else if (b.hasAttribute("data-apage")) { af.page = Number(b.getAttribute("data-apage")); loadAudit(); }
    else if (b.hasAttribute("data-pact")) matchAction(b.getAttribute("data-pact"));
    else if (b.hasAttribute("data-ppage")) { pf.page = Number(b.getAttribute("data-ppage")); loadPlayers(); }
    else if (b.hasAttribute("data-cpage")) { cf.page = Number(b.getAttribute("data-cpage")); loadClans(); }
    else if (b.hasAttribute("data-pl")) playerToggle(b.getAttribute("data-pl"));
    else if (b.hasAttribute("data-cl")) clanLeaderAction(b.getAttribute("data-cl"), Number(b.getAttribute("data-pid")));
    else if (b.hasAttribute("data-adjrev")) adjRevert(Number(b.getAttribute("data-adjrev")), b.getAttribute("data-kind"));
    else if (b.hasAttribute("data-rpage")) { rf.page = Number(b.getAttribute("data-rpage")); loadReports(); }
    else if (b.hasAttribute("data-rtab")) { rf.view = b.getAttribute("data-rtab"); rf.page = 1; loadReports(); }
    else if (b.hasAttribute("data-rv")) reviewAction(b.getAttribute("data-rv"));
    else if (b.hasAttribute("data-evhide")) evHide(b.getAttribute("data-evhide"), b.getAttribute("data-hide") === "1");
    else if (b.hasAttribute("data-stab")) { sf.tab = b.getAttribute("data-stab"); sf.page = 1; cmf.page = 1; loadSanciones(); }
    else if (b.hasAttribute("data-spage")) { sf.page = Number(b.getAttribute("data-spage")); loadSanciones(); }
    else if (b.hasAttribute("data-cmpage")) { cmf.page = Number(b.getAttribute("data-cmpage")); loadSanciones(); }
    else if (b.hasAttribute("data-dpage")) { df.page = Number(b.getAttribute("data-dpage")); loadDiscs(); }
    else if (b.hasAttribute("data-dact")) discAction(b.getAttribute("data-dact"));
    else if (b.hasAttribute("data-sact")) sanctionAction(b.getAttribute("data-sact"));
    else if (b.id === "cm-new") location.hash = "#panel/denuncia/nueva";
    else if (b.id === "mf-new") location.hash = "#panel/partidos/nuevo";
    else if (b.id === "mf-clear") { mf = { q: "", status: "", mode: "", from: "", to: "", page: 1 }; loadMatches(); }
    else if (b.id === "af-clear") { af = { actor: "", action: "", player: "", clan: "", match: "", from: "", to: "", page: 1 }; loadAudit(); }
  });
  root.addEventListener("change", function (e) {
    if (e.target.id === "gev-file") { var o = curOwner(), f = e.target.files[0]; if (o && f) { uploadGeneric(f, o.type, o.id, function () { reloadOwner(o.type, o.id); }); } e.target.value = ""; return; }
    if (e.target.id === "dn-clan") { var cid = e.target.value; if (cid) location.hash = "#panel/disc-nuevo/" + cid; return; }
    if (e.target.id === "ev-file") { uploadFile(e.target.files[0], cur.match.id, function () { loadMatch(cur.match.id); }); e.target.value = ""; }
  });
  function evHide(id, hide) {
    dialog((hide ? "La evidencia dejará de verse para los clanes." : "La evidencia volverá a verse para los clanes.") + "\n\nEscribe el motivo:", { input: "Motivo (obligatorio)", ok: "Continuar" }).then(function (reason) {
      if (reason === null) return;
      if (reason.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return; }
      post("/api/admin/evidence/hide", { id: Number(id), hide: hide, reason: reason }).then(function (r) { if (r.ok) { say("Evidencia actualizada.", "ok"); var o = curOwner(); if (o) reloadOwner(o.type, o.id); else loadMatch(cur.match.id); } else say(r.error || "No se pudo.", "err"); });
    });
  }
  function addLink() {
    if (busy) return; busy = true;
    post("/api/admin/evidence/link", { id: cur.match.id, url: document.getElementById("ev-url").value.trim(), label: document.getElementById("ev-label").value.trim() })
      .then(function (r) { busy = false; if (r.ok) { say("Enlace agregado.", "ok"); loadMatch(cur.match.id); } else say(r.error || "No se pudo agregar.", "err"); })
      .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }
  var noteKey = newKey();
  function addNote() {
    var text = document.getElementById("note-text").value.trim();
    if (text.length < 3) { say("Escribe la nota (al menos 3 caracteres).", "err"); return; }
    if (busy) return; busy = true;
    post("/api/admin/match/note", { id: cur.match.id, kind: document.getElementById("note-kind").value, text: text, key: noteKey })
      .then(function (r) { busy = false; if (r.ok) { noteKey = newKey(); say("Nota guardada.", "ok"); loadMatch(cur.match.id); } else say(r.error || "No se pudo guardar.", "err"); })
      .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }
  function saveCfg() {
    var reason = document.getElementById("cfg-reason").value.trim();
    if (reason.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return; }
    if (busy) return; busy = true;
    post("/api/admin/config", { unreportedHours: Number(document.getElementById("cfg-hours").value), disputeCounts: document.getElementById("cfg-dispute").value, reason: reason })
      .then(function (r) { busy = false; if (r.ok) { say("Configuración guardada.", "ok"); loadConfig(); } else say(r.error || "No se pudo guardar.", "err"); })
      .catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }
  function playerToggle(what) {
    var on = what === "activate";
    act(on ? "Se activará la cuenta." : "Se desactivará la cuenta: se cerrarán sus sesiones y no podrá entrar.", "/api/admin/player/update", { id: curP.player.id, action: "set_active", active: on }, on ? "Cuenta activada." : "Cuenta desactivada.", function () { loadPlayer(curP.player.id); });
  }
  function clanLeaderAction(a, pid) {
    var t = { set_main: "Será el Líder principal; los demás Líderes pasarán a Colíder.", set_co: "Se designará Colíder.", revoke_co: "Se le quitará el rango de Colíder." }[a];
    act(t, "/api/admin/clan/leader", { id: curC.clan.id, action: a, playerId: pid }, "Cambio guardado.", function () { loadClan(curC.clan.id); });
  }
  function adjRevert(id, kind) {
    act("Se revertirá este ajuste y las estadísticas volverán a calcularse sin él.", "/api/admin/adjust/revoke", { id: id, kind: kind }, "Ajuste revertido.", function () { if (kind === "clan") loadClan(curC.clan.id); else loadPlayer(curP.player.id); });
  }
  function adjSubmit(form) {
    var w = Number(document.getElementById("adj-w").value) || 0, l = Number(document.getElementById("adj-l").value) || 0;
    if (!w && !l) { say("Indica cuántas victorias o derrotas sumar o restar.", "err"); return; }
    var kind = form.getAttribute("data-kind"), id = Number(form.getAttribute("data-id"));
    askReason("Ajuste excepcional de " + (w > 0 ? "+" : "") + w + " victoria(s) y " + (l > 0 ? "+" : "") + l + " derrota(s). Quedará registrado con los valores antes y después.").then(function (reason) {
      if (reason === null || busy) return; busy = true;
      post("/api/admin/" + kind + "/adjust", { id: id, winsDelta: w, lossesDelta: l, reason: reason, confirm: true, key: adjKey }).then(function (r) {
        busy = false;
        if (r.ok) { adjKey = newKey(); say("Ajuste registrado: " + r.before.victorias + "/" + r.before.derrotas + " → " + r.after.victorias + "/" + r.after.derrotas + ".", "ok"); if (kind === "clan") loadClan(id); else loadPlayer(id); }
        else say(r.error || "No se pudo registrar.", "err");
      }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
    });
  }
  function pnoteSubmit(form) {
    var text = document.getElementById("pnote-text").value.trim();
    if (text.length < 3) { say("Escribe la nota (al menos 3 caracteres).", "err"); return; }
    if (busy) return; busy = true;
    var type = form.getAttribute("data-type"), id = Number(form.getAttribute("data-id"));
    post("/api/admin/note", { targetType: type, targetId: id, text: text, public: !!(document.getElementById("pnote-pub") && document.getElementById("pnote-pub").checked), key: pnoteKey }).then(function (r) {
      busy = false; if (r.ok) { pnoteKey = newKey(); say("Nota guardada.", "ok"); if (type === "clan") loadClan(id); else if (type === "player") loadPlayer(id); else reloadOwner(type, id); } else say(r.error || "No se pudo guardar.", "err");
    }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); });
  }
  root.addEventListener("submit", function (e) {
    var id = e.target.id;
    var v = function (x) { return document.getElementById(x).value; };
    if (id === "mf-form") { e.preventDefault(); mf = { q: v("mf-q").trim(), status: v("mf-status"), mode: v("mf-mode").trim(), from: v("mf-from"), to: v("mf-to"), page: 1 }; loadMatches(); }
    else if (id === "af-form") { e.preventDefault(); af = { actor: v("af-actor").trim(), action: v("af-action").trim(), player: v("af-player").replace(/\D/g, ""), clan: v("af-clan").replace(/\D/g, ""), match: v("af-match"), from: v("af-from"), to: v("af-to"), page: 1 }; loadAudit(); }
    else if (id === "pm-form") saveMatch(e);
    else if (id === "rf-form") { e.preventDefault(); rf.q = v("rf-q").trim(); rf.page = 1; loadReports(); }
    else if (id === "ev-link-form") { e.preventDefault(); addLink(); }
    else if (id === "note-form") { e.preventDefault(); addNote(); }
    else if (id === "cfg-form") { e.preventDefault(); saveCfg(); }
    else if (id === "pf-form") { e.preventDefault(); pf = { q: v("pf-q").trim(), status: v("pf-status"), page: 1 }; loadPlayers(); }
    else if (id === "cf-form") { e.preventDefault(); cf = { q: v("cf-q").trim(), page: 1 }; loadClans(); }
    else if (id === "lf-form") { e.preventDefault(); lf = { q: v("lf-q").trim() }; loadLeaders(); }
    else if (id === "pl-rename") { e.preventDefault(); act("Se cambiará el nick del jugador.", "/api/admin/player/update", { id: curP.player.id, action: "rename", alias: v("pl-alias").trim() }, "Nick actualizado.", function () { loadPlayer(curP.player.id); }); }
    else if (id === "pl-move") { e.preventDefault(); act("Se cambiará el clan y el rango del jugador.", "/api/admin/player/update", { id: curP.player.id, action: "move_clan", clanId: Number(v("pl-clan")), role: v("pl-role") }, "Clan y rango actualizados.", function () { loadPlayer(curP.player.id); }); }
    else if (id === "cl-edit") { e.preventDefault(); act("Se modificarán los datos del clan.", "/api/admin/clan/update", { id: curC.clan.id, name: v("cl-name").trim(), tag: v("cl-tag").trim(), website: v("cl-web").trim(), logo: v("cl-logo").trim() }, "Clan actualizado.", function () { loadClan(curC.clan.id); }); }
    else if (id === "adj-form") { e.preventDefault(); adjSubmit(e.target); }
    else if (id === "sf-form") { e.preventDefault(); sf.q = v("sf-q").trim(); if (document.getElementById("sf-status")) { sf.status = v("sf-status"); sf.type = v("sf-type"); } sf.page = 1; loadSanciones(); }
    else if (id === "cmf-form") { e.preventDefault(); cmf = { status: v("cmf-status"), q: v("cmf-q").trim(), page: 1 }; loadSanciones(); }
    else if (id === "df-form") { e.preventDefault(); df = { status: v("df-status"), page: 1 }; loadDiscs(); }
    else if (id === "ns-form") { e.preventDefault(); submitSanction(); }
    else if (id === "gev-form") { e.preventDefault(); gevAdd(e.target); }
    else if (id === "s-edit") { e.preventDefault(); act("Se cambiará la duración de la sanción (cuenta desde su inicio).", "/api/admin/sanction/edit", { id: curS.sanction.id, days: Number(v("s-days")) }, "Duración modificada.", function () { loadSancion(curS.sanction.id); }); }
    else if (id === "s-appeal") { e.preventDefault(); var dec = v("sa-dec"); if (v("sa-res").trim().length < 10) { say("Escribe la resolución (al menos 10 caracteres).", "err"); return; } act("Se resolverá la apelación.", "/api/admin/sanction/appeal", { id: curS.sanction.id, decision: dec, resolution: v("sa-res").trim() }, "Apelación resuelta.", function () { loadSancion(curS.sanction.id); }); }
    else if (id === "cm-form") { e.preventDefault(); var stt = v("cm-status"), data = { id: curCm.complaint.id, status: stt, resolution: v("cm-res").trim() }, rs = v("cm-reason").trim(); if (rs.length < 5) { say("Escribe el motivo (al menos 5 caracteres).", "err"); return; } data.reason = rs; if (busy) return; busy = true; post("/api/admin/complaint/update", data).then(function (r) { if (r.status === 409 && /sin sanci/.test(r.error || "")) { busy = false; dialog(r.error, { ok: "Cerrar sin sanción" }).then(function (ok) { if (ok) { data.confirmNoSanction = true; busy = true; post("/api/admin/complaint/update", data).then(function (r2) { busy = false; if (r2.ok) { say("Denuncia actualizada.", "ok"); loadDenuncia(data.id); } else say(r2.error || "No se pudo.", "err"); }); } }); return; } busy = false; if (r.ok) { say("Denuncia actualizada.", "ok"); loadDenuncia(data.id); } else say(r.error || "No se pudo guardar.", "err"); }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); }); }
    else if (id === "cn-form") { e.preventDefault(); if (busy) return; busy = true; post("/api/admin/complaint/create", { accusedAlias: v("cn-acc").trim(), accuserAlias: v("cn-by").trim(), matchId: Number(v("cn-match")) || 0, description: v("cn-desc").trim(), key: cKey }).then(function (r) { busy = false; if (r.ok) { cKey = newKey(); location.hash = "#panel/denuncia/" + r.id; } else say(r.error || "No se pudo registrar.", "err"); }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); }); }
    else if (id === "dn-form") { e.preventDefault(); if (busy) return; busy = true; post("/api/admin/disc/create", { clanId: Number(v("dn-clan")), leaderId: Number(v("dn-leader")), matchId: Number(v("dn-match")) || 0, severity: v("dn-sev"), deadlineDays: Number(v("dn-days")) || 7, reason: v("dn-reason").trim(), description: v("dn-desc").trim(), key: dKey }).then(function (r) { busy = false; if (r.ok) { dKey = newKey(); location.hash = "#panel/disc/" + r.id; } else say(r.error || "No se pudo crear.", "err"); }).catch(function () { busy = false; say("No hay conexión con el servidor.", "err"); }); }
    else if (id === "d-res") { e.preventDefault(); var rr = v("dr-res").trim(); if (rr.length < 10) { say("Escribe la resolución (al menos 10 caracteres).", "err"); return; } act("Se marcará el reporte como resuelto.", "/api/admin/disc/update", { id: curD.disc.id, action: "resolve", resolution: rr, measures: v("dr-meas").trim() }, "Reporte resuelto.", function () { loadDisc(curD.disc.id); }); }
    else if (id === "pnote-form") { e.preventDefault(); pnoteSubmit(e.target); }
  });
})();
