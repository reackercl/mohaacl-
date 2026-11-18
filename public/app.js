(function () {
  var PER_PAGE = 25;
  var rowsEl = document.getElementById("rows");
  var pagesEl = document.getElementById("pages");
  var ladderPage = 1;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ftime(ms) {
    return new Date(ms).toLocaleString("es-CL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).replace(".", "");
  }
  function fshort(ms) {
    if (!ms) return "—";
    var d = new Date(ms), m = d.toLocaleDateString("es-CL", { month: "long" });
    return m.charAt(0).toUpperCase() + m.slice(1) + " " + ("0" + d.getDate()).slice(-2);
  }
  function fdate(ms) { return ms ? new Date(ms).toLocaleDateString("es-CL") : "—"; }
  // Confirmación propia (window.confirm queda bloqueado dentro de páginas incrustadas y nunca respondía).
  function ask(message, okLabel) {
    return new Promise(function (resolve) {
      var back = document.createElement("div");
      back.className = "modal-back";
      var box = document.createElement("div");
      box.className = "modal"; box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
      var p = document.createElement("p"); p.textContent = message;
      var row = document.createElement("div"); row.className = "row";
      var ok = document.createElement("button"); ok.type = "button"; ok.textContent = okLabel || "Aceptar";
      var no = document.createElement("button"); no.type = "button"; no.textContent = "Cancelar";
      row.appendChild(ok); row.appendChild(no); box.appendChild(p); box.appendChild(row); back.appendChild(box);
      function done(v) { document.removeEventListener("keydown", key); back.remove(); resolve(v); }
      function key(e) { if (e.key === "Escape") done(false); }
      ok.addEventListener("click", function () { done(true); });
      no.addEventListener("click", function () { done(false); });
      back.addEventListener("click", function (e) { if (e.target === back) done(false); });
      document.addEventListener("keydown", key);
      document.body.appendChild(back);
      ok.focus();
    });
  }
  function getJson(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    });
  }
  function pagerHtml(page, total, per, attr) {
    var pages = Math.ceil(total / per);
    if (pages <= 1) return "";
    return '<button type="button" class="linkbtn" data-' + attr + '="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + '>« Anterior</button> Página ' + page + " de " + pages +
      ' <button type="button" class="linkbtn" data-' + attr + '="' + (page + 1) + '"' + (page >= pages ? " disabled" : "") + ">Siguiente »</button>";
  }

  function loadLadder(page) {
    ladderPage = page;
    var pagerEl = document.getElementById("pager"), foot = document.getElementById("ladder-foot");
    getJson("/api/clans?page=" + page).then(function (j) {
      if (!j.clans) throw new Error();
      document.getElementById("ladder-foot-text").textContent = j.clans.length
        ? "Estos son " + j.ranked + " Ranked y " + (j.totalClans - j.ranked) + " Clanes no rankeados en este Ladder"
        : "Todavía no hay clanes inscritos en este Ladder";
      foot.hidden = false;
      if (!j.clans.length) {
        rowsEl.innerHTML = "";
        pagesEl.innerHTML = "";
        pagerEl.hidden = true;
        return;
      }
      var now = Date.now();
      rowsEl.innerHTML = j.clans.map(function (c) {
        var g = c.wins + c.losses, pct = g ? Math.round(c.wins * 100 / g) : 0;
        var inac = Math.floor((now - (c.lastMatch || c.created)) / 86400000);
        var arrow = c.trend > 0 ? '<img class="trend" src="img/up.svg" width="12" height="14" alt="Sube de posición" title="Subió de posición">'
          : c.trend < 0 ? '<img class="trend" src="img/down.svg" width="12" height="14" alt="Baja de posición" title="Bajó de posición">' : "";
        var heat = c.streak >= 10 ? ' <img class="heat" src="img/hot.gif" width="38" height="13" alt="HOT" title="10 victorias seguidas o más">'
          : c.streak <= -5 ? ' <img class="heat" src="img/cold.gif" width="32" height="18" alt="COLD" title="5 derrotas seguidas o más">' : "";
        var info = "N/A", rep = '<span title="ID del clan: el clan que pierde la usa para reportar la derrota">' + c.id + "</span>";
        if (c.last) {
          info = (c.last.won ? "Derroto a " : "Perdio con ") + '<a href="#clan/' + c.last.opponentId + '">' + esc(c.last.opponent) + "</a>";
        }
        var posCell = c.rank ? '<span class="posnum">' + c.rank + "</span>" + arrow : '<span class="posnum unr" title="Sin ranking: necesita 5 jugadores o 2 victorias confirmadas">NR</span>';
        return '<tr' + (c.rank ? "" : ' class="unranked"') + '><td class="pos">' + posCell + "</td>" +
          '<td class="clan"><a href="#clan/' + c.id + '">' + esc(c.name) + "</a>" + heat + "</td>" +
          "<td>" + c.wins + "</td><td>" + c.losses + "</td><td>" + c.streak + "</td><td>" + pct + "%</td>" +
          "<td>" + info + "</td><td>" + inac + "</td><td>" + rep + "</td></tr>";
      }).join("");
      var pageCount = Math.ceil(j.total / j.per), html = "";
      pagerEl.hidden = pageCount <= 1;
      var unr = j.totalClans - j.ranked, note = document.getElementById("pager-note");
      note.hidden = unr <= 0 || pageCount <= 1; note.setAttribute("data-page", Math.max(1, Math.ceil((j.ranked + 1) / j.per)));
      for (var p = 1; p <= pageCount; p++) {
        var from = (p - 1) * j.per + 1, to = Math.min(p * j.per, j.total);
        var label = p === page ? "[" + from + "-" + to + "]" : from + "-" + to;
        html += '<button type="button" data-page="' + p + '"' + (p === page ? ' aria-current="page"' : "") + ">" + label + "</button>";
      }
      pagesEl.innerHTML = html;
    }).catch(function () {
      rowsEl.innerHTML = '<tr><td colspan="9">No se pudo cargar el ladder.</td></tr>';
      foot.hidden = true; pagerEl.hidden = true;
    });
  }

  document.getElementById("show-unranked").addEventListener("click", function () { loadLadder(Number(document.getElementById("pager-note").getAttribute("data-page")) || 1); window.scrollTo(0, document.body.scrollHeight); });

  // Ladder Hall Of Fame: más ganados, más perdidos y mejor racha
  var HALL = {
    ganados: { type: "wins", title: "Más partidos ganados", col: "Ganados", val: function (c) { return c.wins; } },
    perdidos: { type: "losses", title: "Más partidos perdidos", col: "Perdidos", val: function (c) { return c.losses; } },
    racha: { type: "streak", title: "Mejor racha", col: "Mejor racha", val: function (c) { return c.best; } }
  };
  function loadHall(h) {
    var cfg = HALL[h], rows = document.getElementById("hall-rows");
    document.getElementById("hall-title").textContent = "Ladder Hall Of Fame • " + cfg.title;
    document.getElementById("hall-col").textContent = cfg.col;
    getJson("/api/hall?type=" + cfg.type).then(function (j) {
      if (!j.clans) throw new Error();
      rows.innerHTML = j.clans.length ? j.clans.map(function (c, i) {
        var g = c.wins + c.losses;
        return "<tr><td>" + (i + 1) + '</td><td class="l"><a href="#clan/' + c.id + '">' + esc(c.name) + "</a></td><td><b>" + cfg.val(c) + "</b></td><td>" + c.losses + "</td><td>" + c.streak + "</td><td>" + (g ? Math.round(c.wins * 100 / g) : 0) + "%</td></tr>";
      }).join("") : '<tr><td class="none" colspan="6">Aún no hay clanes en esta lista.</td></tr>';
    }).catch(function () { rows.innerHTML = '<tr><td class="none" colspan="6">No se pudo cargar la lista.</td></tr>'; });
  }

  // Medal of Honor: lista de temporadas (ladders)
  var CUP = ["", "oro", "plata", "bronce"];
  function cupSrc(n) { return "img/copa-" + n + ".gif"; }
  function loadMohaa() {
    var ul = document.getElementById("mo-seasons");
    getJson("/api/seasons").then(function (j) {
      if (!j.seasons) throw new Error();
      ul.innerHTML = j.seasons.length ? j.seasons.map(function (s) {
        var active = s.status === "active";
        var href = active ? "#ladder" : "#temporada/" + s.id;
        var tail = active ? ' <span class="soft">(en juego' + (s.endsAt ? ", cierra el " + fdate(s.endsAt) : "") + ")</span>"
          : (s.top && s.top.length ? ' <span class="soft">' + s.top.map(function (t) { return '<img src="' + cupSrc(CUP[t.rank]) + '" width="16" height="13" alt="' + t.rank + '.º"> ' + esc(t.clan); }).join(" · ") + "</span>" : "");
        return '<li><a href="' + href + '">' + esc(s.label) + "</a>" + tail + "</li>";
      }).join("") : '<li class="none">Todavía no hay ladders. El administrador debe crear la primera temporada.</li>';
    }).catch(function () { ul.innerHTML = '<li class="none">No se pudo cargar la lista.</li>'; });
  }
  // Temporada cerrada: tabla final con copas
  function loadSeason(id) {
    var rows = document.getElementById("ts-rows");
    getJson("/api/season?id=" + parseInt(id, 10)).then(function (j) {
      if (!j.season) { rows.innerHTML = '<tr><td class="none" colspan="6">' + esc(j.error || "No se pudo cargar la temporada.") + "</td></tr>"; return; }
      var s = j.season;
      document.getElementById("ts-title").textContent = s.label;
      document.getElementById("ts-info").textContent = (s.status === "active" ? "Temporada en juego desde el " : "Del ") + fdate(s.startsAt) + (s.closedAt ? " al " + fdate(s.closedAt) : "") + (s.status === "active" ? "." : ". Temporada finalizada.");
      rows.innerHTML = j.results.length ? j.results.map(function (r) {
        var g = r.wins + r.losses;
        return "<tr><td>" + r.rank + '</td><td class="l"><a href="#clan/' + r.clanId + '">' + esc(r.clan) + "</a></td><td>" + r.wins + "</td><td>" + r.losses + "</td><td>" + (g ? Math.round(r.wins * 100 / g) : 0) + "%</td><td>" +
          (r.rank <= 3 ? '<img src="' + cupSrc(CUP[r.rank]) + '" width="16" height="13" alt="Copa de ' + CUP[r.rank] + '">' : "") + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="6">Esta temporada no tiene resultados.</td></tr>';
    }).catch(function () { rows.innerHTML = '<tr><td class="none" colspan="6">No se pudo cargar la temporada.</td></tr>'; });
  }
  // Administración: crear, programar el cierre y cerrar temporadas
  var adMsg = document.getElementById("ad-msg");
  function adSay(m, kind) { adMsg.textContent = m; adMsg.className = "status-line " + (kind || ""); }
  function endOfDay(v) { return v ? new Date(v + "T23:59:59").getTime() : 0; }
  function loadAdmin() {
    var isAdm = !!(me && me.admin);
    document.getElementById("ad-deny").hidden = isAdm;
    document.getElementById("ad-main").hidden = !isAdm;
    if (!isAdm) return;
    getJson("/api/stats").then(function (j) {
      seasonNow = j.season || null; applySeasonLabel();
      var s = seasonNow;
      document.getElementById("ad-active").hidden = !s;
      document.getElementById("ad-create").hidden = !!s;
      if (s) {
        setText("ad-name", s.label);
        getJson("/api/seasons").then(function (sj) {
          var cur = (sj.seasons || []).filter(function (x) { return x.id === s.id; })[0];
          if (cur) { setText("ad-start", fdate(cur.startsAt)); setText("ad-end", cur.endsAt ? fdate(cur.endsAt) : "Sin plazo (lo cierras tú)"); }
        });
      }
    }).catch(function () { adSay("No se pudo cargar.", "err"); });
  }
  document.getElementById("ad-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = document.getElementById("ad-f-name").value.trim();
    if (name.length < 3) { adSay("Escribe el nombre de la temporada (mínimo 3 caracteres).", "err"); return; }
    api("/api/admin/season/create", { name: name, stage: document.getElementById("ad-f-stage").value.trim(), endsAt: endOfDay(document.getElementById("ad-f-end").value) }).then(function (r) {
      if (r.season) { document.getElementById("ad-form").reset(); adSay("Temporada creada. Ya se pueden reportar partidos.", "ok"); loadStats(); loadAdmin(); }
      else adSay(r.error || "No se pudo crear la temporada.", "err");
    }).catch(function () { adSay("No hay conexión con el servidor.", "err"); });
  });
  document.getElementById("ad-deadline-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = document.getElementById("ad-deadline").value;
    if (!v) { adSay("Elige una fecha de cierre.", "err"); return; }
    api("/api/admin/season/deadline", { endsAt: endOfDay(v) }).then(function (r) {
      if (r.ok) { adSay("Plazo guardado.", "ok"); loadAdmin(); } else adSay(r.error || "No se pudo guardar.", "err");
    });
  });
  document.getElementById("ad-nodeadline").addEventListener("click", function () {
    api("/api/admin/season/deadline", { endsAt: 0 }).then(function (r) {
      if (r.ok) { document.getElementById("ad-deadline").value = ""; adSay("Plazo quitado.", "ok"); loadAdmin(); } else adSay(r.error || "No se pudo.", "err");
    });
  });
  document.getElementById("ad-close").addEventListener("click", function () {
    ask("¿Cerrar la temporada " + curLabel() + "? Se guarda la tabla final, los 3 primeros reciben copa y el ladder vuelve a cero. No se puede deshacer.", "Cerrar temporada").then(function (yes) {
      if (!yes) return;
      api("/api/admin/season/close", {}).then(function (r) {
        if (r.ok) { adSay("Temporada cerrada. Las copas ya están asignadas.", "ok"); loadStats(); loadAdmin(); } else adSay(r.error || "No se pudo cerrar.", "err");
      });
    });
  });

  // Cuadro Hall Of Fame del ladder: el clan que encabeza cada lista
  function loadHof() {
    [["wins", "hof-wins"], ["losses", "hof-losses"], ["streak", "hof-streak"]].forEach(function (x) {
      getJson("/api/hall?type=" + x[0]).then(function (j) {
        var el = document.getElementById(x[1]), c = j.clans && j.clans[0];
        el.textContent = "";
        if (!c) { el.textContent = "—"; return; }
        var a = document.createElement("a"); a.href = "#clan/" + c.id; a.textContent = c.name; el.appendChild(a);
      }).catch(function () {});
    });
  }

  pagesEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-page]");
    if (b) loadLadder(Number(b.getAttribute("data-page")));
  });

  // Vistas: #inicio, #ladder y #nuevo-jugador. Otros enlaces del menú no cambian la vista.
  var views = {
    "inicio": document.getElementById("view-inicio"),
    "ladder": document.getElementById("view-ladder"),
    "nuevo-jugador": document.getElementById("view-nuevo-jugador"),
    "buscar": document.getElementById("view-buscar"),
    "clan": document.getElementById("view-clan"),
    "validar": document.getElementById("view-validar"),
    "jugadores": document.getElementById("view-jugadores"),
    "jugador": document.getElementById("view-jugador"),
    "online": document.getElementById("view-online"),
    "mi-clan": document.getElementById("view-mi-clan"),
    "clanes": document.getElementById("view-clanes"),
    "partidos": document.getElementById("view-partidos"),
    "mapas": document.getElementById("view-mapas"),
    "reglas": document.getElementById("view-reglas"),
    "noticias": document.getElementById("view-noticias"),
    "descargas": document.getElementById("view-descargas"),
    "links": document.getElementById("view-links"),
    "respaldo": document.getElementById("view-respaldo"),
    "vivo": document.getElementById("view-vivo"),
    "servers": document.getElementById("view-servers"),
    "mohaa": document.getElementById("view-mohaa"),
    "temporada": document.getElementById("view-temporada"),
    "admin": document.getElementById("view-admin"),
    "panel": document.getElementById("view-panel"),
    "ganados": document.getElementById("view-hall"),
    "perdidos": document.getElementById("view-hall"),
    "racha": document.getElementById("view-hall"),
    "partido": document.getElementById("view-partido"),
    "reportar": document.getElementById("view-reportar"),
    "confirmar": document.getElementById("view-confirmar")
  };
  var current = "inicio";
  var navLinks = document.querySelectorAll(".menu a[data-view]");
  var keepValidar = false;
  // Con sesión iniciada no tiene sentido registrarse; con la cuenta ya validada tampoco validar.
  function applyGuards() {
    if (!me) return;
    if (current === "nuevo-jugador" || (current === "validar" && me.verified && !keepValidar)) location.hash = "#inicio";
  }
  function showView() {
    var parts = (location.hash || "").slice(1).split("/");
    var h = parts[0];
    if (!views[h]) h = current;
    current = h;
    if (h !== "validar") keepValidar = false;
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== h); });
    if (h === "jugadores") loadPlayers(plPage);
    if (h === "ladder") { loadLadder(ladderPage); loadHof(); }
    if (h === "clanes") loadClanList(csPage);
    if (h === "partidos") loadResults(ptPage);
    if (h === "inicio") { loadHomeMatches(); loadHomeComplaints(); loadHomeNews(); }
    if (h === "ganados" || h === "perdidos" || h === "racha") loadHall(h);
    if (h === "mohaa") loadMohaa();
    if (h === "temporada") loadSeason(parts[1]);
    if (h === "admin") loadAdmin();
    if (h === "panel" && window.LadderPanel) window.LadderPanel.open(parts);
    if (h === "mi-clan") loadMine();
    if (h === "clan") loadClan(parts[1]);
    if (h === "jugador") loadPlayerProfile(parts[1]);
    if (h === "online") loadOnline();
    if (h === "noticias") loadNews(parts[1]);
    if (h === "descargas") loadDownloads();
    if (h === "links") loadLinksAdmin();
    if (h === "respaldo") loadBackups();
    if (h === "vivo") loadLive();
    if (h === "servers") loadServers();
    if (h === "partido") loadMatch(parts[1]);
    if (h === "reportar" || h === "confirmar") loadMatchPanels();
    navLinks.forEach(function (a) {
      if (a.getAttribute("data-view") === h) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    applyGuards();
  }
  window.addEventListener("hashchange", showView);



  // Registro de jugadores: se envía al servidor.
  var suStatus = document.getElementById("su-status");
  function say(msg, kind) { suStatus.textContent = msg; suStatus.className = "status " + kind; }
  function api(url, data) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(data || {})
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j.status = r.status; return j; });
    });
  }
  var suBusy = false;
  document.getElementById("signup").addEventListener("submit", function (e) {
    e.preventDefault();
    if (suBusy) return;
    var v = function (id) { return document.getElementById(id).value.trim(); };
    if (!v("su-alias") || !document.getElementById("su-pass").value || !v("su-mail")) { say("Completa nombre, contraseña y email.", "err"); return; }
    if (document.getElementById("su-pass").value !== document.getElementById("su-pass2").value) { say("Las contraseñas no coinciden.", "err"); return; }
    if (v("su-mail").toLowerCase() !== v("su-mail2").toLowerCase()) { say("Los emails no coinciden.", "err"); return; }
    if (!document.getElementById("su-age").checked) { say("Debes confirmar que tienes al menos 13 años.", "err"); return; }
    suBusy = true;
    say("Creando tu cuenta...", "");
    api("/api/register", {
      alias: v("su-alias"), password: document.getElementById("su-pass").value, email: v("su-mail"),
      logo: v("su-logo"), steam: v("su-steam"), discord: v("su-discord"), twitch: v("su-twitch"), youtube: v("su-youtube"), age13: true,
      adminSetupToken: document.getElementById("su-admin-token").value
    }).then(function (r) {
      suBusy = false;
      if (r.player) {
        document.getElementById("signup").reset();
        document.getElementById("vf-alias").value = r.player.alias;
        keepValidar = true;
        location.hash = "#validar";
        vsay("Cuenta creada. Te enviamos un código de 6 dígitos a tu email: escríbelo aquí para validar tu cuenta.", "ok");
        say("", "");
        setPlayer(r.player);
        refreshMe();
        loadStats();
      } else {
        say(r.error || "No se pudo crear la cuenta.", "err");
      }
    }).catch(function () { suBusy = false; say("No hay conexión con el servidor.", "err"); });
  });

  // Imágenes ajustables (cuadro de arriba y banner): elegir, mover, hacer zoom y volver a la original.
  // La imagen elegida se muestra solo en este navegador y no se guarda.
  function makeFrame(box, defaultSrc) {
    var q = function (c) { return box.querySelector(c); };
    var img = q(".f-img"), file = q(".f-file"), adj = q(".f-adj"), zoom = q(".f-zoom");
    var hs = { x: 0, y: 0, z: 1 }, drag = null;
    function layout() {
      var W = box.clientWidth, H = box.clientHeight, nw = img.naturalWidth, nh = img.naturalHeight;
      if (!nw || !nh || !W) return;
      var k = Math.max(W / nw, H / nh) * hs.z, w = nw * k, h = nh * k, mx = (w - W) / 2, my = (h - H) / 2;
      hs.x = Math.max(-mx, Math.min(mx, hs.x)); hs.y = Math.max(-my, Math.min(my, hs.y));
      img.style.width = w + "px"; img.style.height = h + "px";
      img.style.left = (W - w) / 2 + hs.x + "px"; img.style.top = (H - h) / 2 + hs.y + "px";
    }
    function adjust(on) { box.classList.toggle("adjusting", on); adj.hidden = !on; if (on) layout(); }
    function reset() { hs = { x: 0, y: 0, z: 1 }; zoom.value = 1; layout(); }
    img.addEventListener("load", layout);
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f || f.type.indexOf("image/") !== 0) return;
      var r = new FileReader();
      r.onload = function () { hs = { x: 0, y: 0, z: 1 }; zoom.value = 1; img.onload = function () { layout(); adjust(true); }; img.src = r.result; box.classList.add("has-img"); };
      r.readAsDataURL(f);
    });
    q(".f-adjust").addEventListener("click", function () { adjust(true); });
    q(".f-done").addEventListener("click", function () { adjust(false); });
    q(".f-reset").addEventListener("click", reset);
    zoom.addEventListener("input", function () { hs.z = parseFloat(zoom.value) || 1; layout(); });
    box.addEventListener("wheel", function (ev) {
      if (!box.classList.contains("adjusting")) return;
      ev.preventDefault();
      hs.z = Math.max(1, Math.min(4, hs.z + (ev.deltaY < 0 ? 0.1 : -0.1))); zoom.value = hs.z; layout();
    }, { passive: false });
    box.addEventListener("pointerdown", function (ev) {
      if (!box.classList.contains("adjusting") || ev.target.closest(".f-adj,.tools")) return;
      drag = { px: ev.clientX, py: ev.clientY, x: hs.x, y: hs.y }; box.setPointerCapture(ev.pointerId);
    });
    box.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var zf = box.getBoundingClientRect().width / (box.clientWidth || 1) || 1;
      hs.x = drag.x + (ev.clientX - drag.px) / zf; hs.y = drag.y + (ev.clientY - drag.py) / zf; layout();
    });
    box.addEventListener("pointerup", function () { drag = null; });
    box.addEventListener("pointercancel", function () { drag = null; });
    window.addEventListener("resize", layout);
    q(".f-clear").addEventListener("click", function () {
      adjust(false); file.value = ""; hs = { x: 0, y: 0, z: 1 }; zoom.value = 1; img.removeAttribute("style");
      box.classList.remove("has-img");
      if (defaultSrc) { img.onload = layout; img.src = defaultSrc; } else img.removeAttribute("src");
    });
    if (defaultSrc) { if (img.complete) layout(); }
  }
  makeFrame(document.getElementById("hero"), "");
  makeFrame(document.getElementById("banner"), "/img/banner.jpg");

  // Buscar: clanes o jugadores, directo desde el servidor.
  var searchResult = document.getElementById("search-result");
  document.getElementById("search").addEventListener("submit", function (e) {
    e.preventDefault();
    var term = document.getElementById("q").value.trim();
    var type = document.getElementById("qtype").value;
    if (!term) { searchResult.textContent = "Escribe un nombre para buscar."; return; }
    getJson((type === "1" ? "/api/clans?q=" : "/api/players?q=") + encodeURIComponent(term)).then(function (r) {
      var list = type === "1" ? r.clans : r.players;
      if (!list) { searchResult.textContent = "No se pudo buscar."; return; }
      if (!list.length) { searchResult.textContent = "No se encontraron resultados."; return; }
      searchResult.innerHTML = list.map(function (x) {
        return type === "1" ? '<div><a href="#clan/' + x.id + '">' + esc(x.name) + "</a> (ID " + x.id + ")</div>" : "<div>" + esc(x.alias) + " (ID " + x.id + ")</div>";
      }).join("");
    }).catch(function () { searchResult.textContent = "No se pudo buscar."; });
  });

  // Sesión: login, logout y estado visible en el menú lateral.
  var loginForm = document.getElementById("login");
  var loginMsg = document.createElement("div");
  loginMsg.className = "login-msg";
  loginMsg.setAttribute("role", "status");
  loginForm.appendChild(loginMsg);
  var sessionBox = document.createElement("div");
  sessionBox.className = "session";
  sessionBox.hidden = true;
  sessionBox.innerHTML = '<div>Sesión iniciada como <b id="who"></b></div><div>Tu ID de jugador: <b id="my-id"></b></div><button type="button" id="logout">Cerrar sesión</button>';
  loginForm.parentNode.insertBefore(sessionBox, loginForm.nextSibling);

  // Lista de jugadores (Ladder Player Database): orden alfabético, números de página y buscador debajo
  var plPage = 1, plTerm = "";
  var plRows = document.getElementById("pl-rows"), plPager = document.getElementById("pl-pager");
  var ROLE_PUB = { leader: "Líder", coleader: "Colíder", captain: "Capitán", member: "Miembro" };
  function loadLive() {
    var box = document.getElementById("lv-list"), note = document.getElementById("lv-note");
    getJson("/api/live").then(function (j) {
      var n = (j.streams || []).length, cnt = document.getElementById("live-count");
      cnt.hidden = !n; cnt.textContent = n ? "● " + n : "";
      if (!n) {
        var cfg = j.configured || {};
        note.textContent = (cfg.twitch || cfg.youtube)
          ? "Aquí aparecen los jugadores que están transmitiendo ahora en Twitch o YouTube, según los canales de su perfil."
          : "La detección de transmisiones todavía no está activada: el administrador debe configurar las claves de Twitch y/o YouTube.";
        box.innerHTML = (cfg.twitch || cfg.youtube) ? '<div class="none">Nadie está transmitiendo en este momento.</div>' : "";
        return;
      }
      note.textContent = "Transmisiones en vivo ahora (se actualiza cada pocos minutos). Para aparecer, deja el enlace de tu canal en Manejo de cuenta → Mis redes.";
      box.innerHTML = j.streams.map(function (s, i) {
        var tw = s.platform === "twitch", src, link;
        if (tw) { src = "https://player.twitch.tv/?channel=" + encodeURIComponent(s.channel) + "&parent=" + encodeURIComponent(location.hostname) + "&muted=true&autoplay=false"; link = "https://www.twitch.tv/" + encodeURIComponent(s.channel); }
        else { src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(s.videoId); link = "https://www.youtube.com/watch?v=" + encodeURIComponent(s.videoId); }
        return '<div class="lv-item"><div class="lv-head"><span class="lv-badge ' + (tw ? "tw" : "yt") + '">' + (tw ? "Twitch" : "YouTube") + '</span> <a href="#jugador/' + s.playerId + '">' + esc(s.alias) + "</a>" +
          (s.viewers ? ' <span class="lv-views">' + s.viewers + " espectadores</span>" : "") + "</div>" +
          (s.title ? '<div class="lv-title">' + esc(s.title) + "</div>" : "") +
          '<div class="lv-frame"><iframe src="' + esc(src) + '" title="Transmisión de ' + esc(s.alias) + '" loading="' + (i < 3 ? "eager" : "lazy") + '" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>' +
          '<div class="lv-open"><a href="' + esc(link) + '" target="_blank" rel="noopener nofollow">Abrir en ' + (tw ? "Twitch" : "YouTube") + "</a></div></div>";
      }).join("");
    }).catch(function () { box.innerHTML = '<div class="none">No se pudo cargar. Intenta de nuevo.</div>'; });
  }
  // El contador del menú se actualiza al entrar al sitio.
  getJson("/api/live").then(function (j) { var n = (j.streams || []).length, c = document.getElementById("live-count"); if (c) { c.hidden = !n; c.textContent = n ? "● " + n : ""; } }).catch(function () {});

  // Archivo de noticias: lectura pública + panel de publicación para administración y encargados de noticias
  var nwCat = "", nwPage = 1, nwAdminOk = false, nwEditing = null;
  function nwDate(ms) { return ms ? new Date(ms).toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }) : ""; }
  function nwBody(t) {
    return esc(t).split(/\n{2,}/).map(function (p) {
      return "<p>" + p.replace(/\n/g, "<br>").replace(/(https:\/\/[^\s<]+)/g, function (u) { return '<a href="' + u + '" target="_blank" rel="noopener nofollow">' + u + "</a>"; }) + "</p>";
    }).join("");
  }
  function loadHomeNews() {
    var ul = document.getElementById("home-news");
    getJson("/api/news?limit=5").then(function (j) {
      var l = j.news || [];
      ul.innerHTML = l.length ? l.map(function (n) { return '<li><a href="#noticias/' + n.id + '">' + (n.category !== "noticia" ? "<b>" + esc(n.categoryLabel) + ":</b> " : "") + esc(n.title) + "</a></li>"; }).join("") : '<li class="none">Aún no hay noticias.</li>';
    }).catch(function () {});
  }
  function loadNews(id) {
    var listCard = document.getElementById("nw-list-card"), itemCard = document.getElementById("nw-item-card");
    if (id) {
      listCard.hidden = true; itemCard.hidden = false;
      var box = document.getElementById("nw-item"); box.innerHTML = '<div class="none">Cargando...</div>';
      getJson("/api/news/item?id=" + encodeURIComponent(id)).then(function (j) {
        if (!j.item) { box.innerHTML = '<div class="none">' + esc(j.error || "Esa noticia no existe.") + "</div>"; return; }
        var n = j.item;
        box.innerHTML = '<h3 class="nw-h">' + esc(n.title) + '</h3><div class="nw-meta"><span class="nw-tag nw-' + esc(n.category) + '">' + esc(n.categoryLabel) + "</span> " + nwDate(n.at) + " · por " + esc(n.author) + (n.eventAt ? " · <b>Fecha del evento: " + nwDate(n.eventAt) + "</b>" : "") + '</div><div class="nw-body">' + nwBody(n.body) + "</div>";
      }).catch(function () { box.innerHTML = '<div class="none">No se pudo cargar.</div>'; });
    } else {
      listCard.hidden = false; itemCard.hidden = true;
      var list = document.getElementById("nw-list");
      document.querySelectorAll("#nw-filter button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-nwcat") === nwCat); });
      getJson("/api/news?page=" + nwPage + (nwCat ? "&cat=" + nwCat : "")).then(function (j) {
        var l = j.news || [];
        list.innerHTML = l.length ? l.map(function (n) {
          return '<div class="nw-item"><div class="nw-meta"><span class="nw-tag nw-' + esc(n.category) + '">' + esc(n.categoryLabel) + "</span> " + (n.pinned ? "📌 " : "") + nwDate(n.at) + " · " + esc(n.author) + (n.eventAt ? " · Evento: " + nwDate(n.eventAt) : "") + '</div><a class="nw-title" href="#noticias/' + n.id + '">' + esc(n.title) + '</a><div class="nw-sum">' + esc(n.body) + "</div></div>";
        }).join("") : '<div class="none">No hay noticias publicadas todavía.</div>';
        var pages = Math.ceil(j.total / j.per);
        document.getElementById("nw-pager").innerHTML = pages > 1 ? pageNumbers(j.page, pages, "nw") : "";
      }).catch(function () { list.innerHTML = '<div class="none">No se pudo cargar.</div>'; });
    }
    loadNewsAdmin();
  }
  document.getElementById("nw-filter").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-nwcat]"); if (!b) return;
    nwCat = b.getAttribute("data-nwcat"); nwPage = 1; loadNews();
  });
  document.getElementById("nw-pager").addEventListener("click", function (e) {
    var b = e.target.closest("[data-nw]"); if (!b) return;
    nwPage = Number(b.getAttribute("data-nw")); loadNews();
  });
  function nwReset() {
    nwEditing = null;
    document.getElementById("nw-id").value = ""; document.getElementById("nw-title").value = ""; document.getElementById("nw-body").value = "";
    document.getElementById("nw-cat").value = "noticia"; document.getElementById("nw-date").value = "";
    document.getElementById("nw-pub").checked = true; document.getElementById("nw-pin").checked = false;
    document.getElementById("nw-save").textContent = "Publicar";
  }
  function loadNewsAdmin() {
    var box = document.getElementById("nw-admin");
    getJson("/api/admin/me").then(function (m) {
      var ok = m.status === 200 && m.perms && (m.perms.indexOf("*") >= 0 || m.perms.indexOf("news.manage") >= 0);
      nwAdminOk = !!ok; box.hidden = !ok;
      if (!ok) return;
      document.getElementById("nw-role").textContent = "(" + (m.roleLabel || "") + ")";
      return getJson("/api/admin/news").then(function (j) {
        var rows = document.getElementById("nw-rows"), l = j.news || [];
        window.__nwData = {}; l.forEach(function (n) { window.__nwData[n.id] = n; });
        rows.innerHTML = l.length ? l.map(function (n) {
          return "<tr><td class=\"l\">" + (n.pinned ? "📌 " : "") + '<a href="#noticias/' + n.id + '">' + esc(n.title) + "</a></td><td>" + esc(n.category) + "</td><td>" + (n.published ? "Publicada" : "Borrador") + "</td><td>" + nwDate(n.at) + '</td><td><button type="button" class="linkbtn" data-nwedit="' + n.id + '">Editar</button> <button type="button" class="linkbtn" data-nwdel="' + n.id + '">Eliminar</button></td></tr>';
        }).join("") : '<tr><td class="none" colspan="5">Todavía no hay noticias.</td></tr>';
      });
    }).catch(function () { box.hidden = true; });
  }
  document.getElementById("nw-new").addEventListener("click", function () { nwReset(); document.getElementById("nw-msg").textContent = ""; });
  document.getElementById("nw-rows").addEventListener("click", function (e) {
    var ed = e.target.closest("[data-nwedit]"), del = e.target.closest("[data-nwdel]");
    var msg = document.getElementById("nw-msg");
    if (ed) {
      var n = (window.__nwData || {})[ed.getAttribute("data-nwedit")]; if (!n) return;
      nwEditing = n.id;
      document.getElementById("nw-id").value = n.id; document.getElementById("nw-title").value = n.title; document.getElementById("nw-body").value = n.body;
      document.getElementById("nw-cat").value = n.category; document.getElementById("nw-pub").checked = n.published; document.getElementById("nw-pin").checked = n.pinned;
      document.getElementById("nw-date").value = n.eventAt ? new Date(n.eventAt).toISOString().slice(0, 10) : "";
      document.getElementById("nw-save").textContent = "Guardar cambios"; msg.textContent = "Editando: " + n.title;
      document.getElementById("nw-form").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (del) {
      var nd = (window.__nwData || {})[del.getAttribute("data-nwdel")]; if (!nd) return;
      if (!confirm("¿Eliminar la noticia «" + nd.title + "»? No se puede deshacer.")) return;
      api("/api/admin/news/delete", { id: nd.id }).then(function (r) {
        if (r.ok) { if (nwEditing === nd.id) nwReset(); msg.textContent = "Noticia eliminada."; loadNews(); loadHomeNews(); } else msg.textContent = r.error || "No se pudo eliminar.";
      });
    }
  });
  document.getElementById("nw-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("nw-msg"), d = document.getElementById("nw-date").value;
    var data = {
      id: nwEditing || undefined, title: document.getElementById("nw-title").value.trim(), body: document.getElementById("nw-body").value,
      category: document.getElementById("nw-cat").value, published: document.getElementById("nw-pub").checked, pinned: document.getElementById("nw-pin").checked,
      eventAt: d ? new Date(d + "T12:00:00").getTime() : 0
    };
    msg.textContent = "Guardando...";
    api("/api/admin/news/save", data).then(function (r) {
      if (r.ok) { msg.textContent = nwEditing ? "Cambios guardados." : "Noticia publicada."; nwReset(); loadNews(); loadHomeNews(); } else msg.textContent = r.error || "No se pudo guardar.";
    }).catch(function () { msg.textContent = "No se pudo guardar."; });
  });

  // Respaldo de la base de datos (superadministrador)
  function loadBackups() {
    getJson("/api/admin/backup/list").then(function (j) {
      var box = document.getElementById("bk-box"), note = document.getElementById("bk-note");
      if (j.error) { box.hidden = true; note.textContent = "Esta sección es solo para el superadministrador."; return; }
      box.hidden = false;
      document.getElementById("bk-info").textContent = "Se crea uno automático cada " + j.everyHours + " h y al apagarse el servidor; se guardan los últimos " + j.keep + ". Copia externa: " + (j.external ? "activada" : "no configurada (ver LEEME)") + ".";
      document.getElementById("bk-rows").innerHTML = (j.backups || []).length ? j.backups.map(function (b) {
        return "<tr><td class=\"l\">" + esc(b.file) + "</td><td>" + new Date(b.at).toLocaleString("es-CL") + "</td><td>" + (b.size / 1024 < 1024 ? Math.round(b.size / 1024) + " KB" : (b.size / 1048576).toFixed(1) + " MB") + '</td><td><a href="/api/admin/backup/download?file=' + encodeURIComponent(b.file) + '">Descargar</a></td></tr>';
      }).join("") : '<tr><td class="none" colspan="4">Todavía no hay respaldos. Crea el primero.</td></tr>';
    }).catch(function () {});
  }
  document.getElementById("bk-run").addEventListener("click", function () {
    var msg = document.getElementById("bk-msg"); msg.textContent = "Creando respaldo...";
    api("/api/admin/backup/run", {}).then(function (r) {
      msg.textContent = r.ok ? "Respaldo creado" + (r.uploaded ? " y subido al almacenamiento externo." : ".") + (r.error ? " " + r.error : "") : (r.error || "No se pudo crear.");
      loadBackups();
    }).catch(function () { msg.textContent = "No se pudo crear."; });
  });

  // Links: banners de otras páginas en la barra lateral (los administra la administración)
  var lkData = {}, lkImage = "";
  function safeHttp(u) { return /^https?:\/\//i.test(u) ? u : "#"; }
  function loadLinks() {
    getJson("/api/links").then(function (j) {
      var l = j.links || [];
      document.getElementById("links-list").innerHTML = l.length ? l.map(function (k) {
        return '<a class="lk" href="' + esc(safeHttp(k.url)) + '" target="_blank" rel="noopener nofollow" title="' + esc(k.title) + '"><img src="' + esc(k.image) + '" alt="' + esc(k.title) + '" referrerpolicy="no-referrer" loading="lazy"></a>';
      }).join("") : '<div class="none">Aún no hay enlaces.</div>';
    }).catch(function () {});
  }
  loadLinks();
  function loadLinksAdmin() {
    var rows = document.getElementById("lk-rows");
    getJson("/api/admin/me").then(function (m) {
      var ok = m.status === 200 && m.perms && (m.perms.indexOf("*") >= 0 || m.perms.indexOf("config.edit") >= 0);
      document.getElementById("lk-form").hidden = !ok;
      document.getElementById("lk-note").textContent = ok ? "Banners de otras páginas que aparecen en la barra de la izquierda, en el cuadro \"Links\". Imagen recomendada: unos 150 px de ancho ." : "Esta sección es solo para la administración.";
      if (!ok) { rows.innerHTML = ""; return; }
      return getJson("/api/links").then(function (j) {
        var l = j.links || []; lkData = {}; l.forEach(function (k) { lkData[k.id] = k; });
        rows.innerHTML = l.length ? l.map(function (k) {
          return '<tr><td><img class="lk-th" src="' + esc(k.image) + '" alt="" referrerpolicy="no-referrer"></td><td class="l"><a href="' + esc(safeHttp(k.url)) + '" target="_blank" rel="noopener nofollow">' + esc(k.title) + '</a></td><td><button type="button" class="linkbtn" data-lkmove="' + k.id + '" data-dir="up">↑</button> <button type="button" class="linkbtn" data-lkmove="' + k.id + '" data-dir="down">↓</button> <button type="button" class="linkbtn" data-lkedit="' + k.id + '">Editar</button> <button type="button" class="linkbtn" data-lkdel="' + k.id + '">Eliminar</button></td></tr>';
        }).join("") : '<tr><td class="none" colspan="3">Todavía no hay links.</td></tr>';
      });
    }).catch(function () {});
  }
  function lkReset() {
    ["lk-id", "lk-title", "lk-url", "lk-img", "lk-file"].forEach(function (i) { document.getElementById(i).value = ""; });
    lkImage = ""; document.getElementById("lk-save").textContent = "Agregar";
  }
  document.getElementById("lk-new").addEventListener("click", function () { lkReset(); document.getElementById("lk-msg").textContent = ""; });
  document.getElementById("lk-file").addEventListener("change", function () {
    var f = this.files && this.files[0], msg = document.getElementById("lk-msg");
    lkImage = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { msg.textContent = "Usa una imagen PNG, JPG, GIF o WEBP."; this.value = ""; return; }
    var r = new FileReader();
    r.onload = function () {
      // Se ajusta solo: se reduce a un máximo de 300 x 120 px (se ve nítido en 150 x 60) manteniendo las proporciones.
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, 300 / im.naturalWidth, 120 / im.naturalHeight), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(im, 0, 0, w, h);
        lkImage = cv.toDataURL("image/png");
        if (lkImage.length > 380000) lkImage = cv.toDataURL("image/jpeg", 0.85);
        msg.textContent = "Imagen lista (ajustada a " + w + " × " + h + " px).";
      };
      im.onerror = function () { msg.textContent = "No se pudo leer la imagen."; };
      im.src = r.result;
    };
    r.readAsDataURL(f);
  });
  document.getElementById("lk-rows").addEventListener("click", function (e) {
    var ed = e.target.closest("[data-lkedit]"), del = e.target.closest("[data-lkdel]"), mv = e.target.closest("[data-lkmove]"), msg = document.getElementById("lk-msg");
    if (ed) {
      var k = lkData[ed.getAttribute("data-lkedit")]; if (!k) return;
      document.getElementById("lk-id").value = k.id; document.getElementById("lk-title").value = k.title; document.getElementById("lk-url").value = k.url;
      document.getElementById("lk-img").value = ""; lkImage = ""; document.getElementById("lk-save").textContent = "Guardar cambios"; msg.textContent = "Editando: " + k.title + " (deja la imagen vacía para conservarla)";
    } else if (del) {
      var kd = lkData[del.getAttribute("data-lkdel")]; if (!kd || !confirm("¿Eliminar el link «" + kd.title + "»?")) return;
      api("/api/admin/links/delete", { id: kd.id }).then(function (r) { if (r.ok) { lkReset(); msg.textContent = "Link eliminado."; loadLinksAdmin(); loadLinks(); } else msg.textContent = r.error || "No se pudo eliminar."; });
    } else if (mv) {
      api("/api/admin/links/move", { id: Number(mv.getAttribute("data-lkmove")), dir: mv.getAttribute("data-dir") }).then(function () { loadLinksAdmin(); loadLinks(); });
    }
  });
  document.getElementById("lk-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("lk-msg"), id = Number(document.getElementById("lk-id").value) || undefined;
    msg.textContent = "Guardando...";
    api("/api/admin/links/save", { id: id, title: document.getElementById("lk-title").value.trim(), url: document.getElementById("lk-url").value.trim(), image: lkImage || document.getElementById("lk-img").value.trim() }).then(function (r) {
      if (r.ok) { msg.textContent = id ? "Cambios guardados." : "Link agregado."; lkReset(); loadLinksAdmin(); loadLinks(); } else msg.textContent = r.error || "No se pudo guardar.";
    }).catch(function () { msg.textContent = "No se pudo guardar."; });
  });

  // Descargas para jugadores nuevos
  var dlData = {};
  function loadDownloads() {
    var box = document.getElementById("dl-list");
    getJson("/api/downloads").then(function (j) {
      var l = j.downloads || [], cats = j.categories || {}; dlData = {};
      l.forEach(function (d) { dlData[d.id] = d; });
      box.innerHTML = l.length ? Object.keys(cats).map(function (k) {
        var items = l.filter(function (d) { return d.category === k; });
        if (!items.length) return "";
        return '<h4 class="dl-cat">' + esc(cats[k]) + "</h4>" + items.map(function (d) {
          return '<div class="dl-item"><div><a class="dl-name" href="' + esc(d.url) + '" target="_blank" rel="noopener nofollow">' + esc(d.title) + "</a>" + (d.info ? ' <span class="dl-info">' + esc(d.info) + "</span>" : "") + (d.description ? '<div class="dl-desc">' + esc(d.description) + "</div>" : "") + '</div><a class="dl-btn" href="' + esc(d.url) + '" target="_blank" rel="noopener nofollow">Descargar</a></div>';
        }).join("");
      }).join("") : '<div class="none">Pronto agregaremos aquí los archivos para jugar. Mientras tanto, pregunta en el foro o en el Discord de la comunidad.</div>';
      renderDlAdmin();
    }).catch(function () { box.innerHTML = '<div class="none">No se pudo cargar.</div>'; });
    getJson("/api/admin/me").then(function (m) {
      var ok = m.status === 200 && m.perms && (m.perms.indexOf("*") >= 0 || m.perms.indexOf("config.edit") >= 0);
      dlAdminOk = !!ok; document.getElementById("dl-admin").hidden = !ok; renderDlAdmin();
    }).catch(function () {});
  }
  var dlAdminOk = false;
  function renderDlAdmin() {
    var rows = document.getElementById("dl-rows"); if (!dlAdminOk) return;
    var l = Object.keys(dlData).map(function (k) { return dlData[k]; });
    rows.innerHTML = l.length ? l.map(function (d) { return '<tr><td class="l">' + esc(d.title) + "</td><td>" + esc(d.category) + '</td><td><button type="button" class="linkbtn" data-dledit="' + d.id + '">Editar</button> <button type="button" class="linkbtn" data-dldel="' + d.id + '">Eliminar</button></td></tr>'; }).join("") : '<tr><td class="none" colspan="3">Sin descargas todavía.</td></tr>';
  }
  function dlReset() {
    ["dl-id", "dl-title", "dl-url", "dl-desc", "dl-info"].forEach(function (i) { document.getElementById(i).value = ""; });
    document.getElementById("dl-cat").value = "juego"; document.getElementById("dl-save").textContent = "Agregar";
  }
  document.getElementById("dl-new").addEventListener("click", function () { dlReset(); document.getElementById("dl-msg").textContent = ""; });
  document.getElementById("dl-rows").addEventListener("click", function (e) {
    var ed = e.target.closest("[data-dledit]"), del = e.target.closest("[data-dldel]"), msg = document.getElementById("dl-msg");
    if (ed) {
      var d = dlData[ed.getAttribute("data-dledit")]; if (!d) return;
      document.getElementById("dl-id").value = d.id; document.getElementById("dl-title").value = d.title; document.getElementById("dl-url").value = d.url;
      document.getElementById("dl-desc").value = d.description || ""; document.getElementById("dl-info").value = d.info || ""; document.getElementById("dl-cat").value = d.category;
      document.getElementById("dl-save").textContent = "Guardar cambios"; msg.textContent = "Editando: " + d.title;
    } else if (del) {
      var dd = dlData[del.getAttribute("data-dldel")]; if (!dd || !confirm("¿Eliminar «" + dd.title + "»?")) return;
      api("/api/admin/downloads/delete", { id: dd.id }).then(function (r) { if (r.ok) { dlReset(); msg.textContent = "Eliminada."; loadDownloads(); } else msg.textContent = r.error || "No se pudo eliminar."; });
    }
  });
  document.getElementById("dl-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("dl-msg"), id = Number(document.getElementById("dl-id").value) || undefined;
    msg.textContent = "Guardando...";
    api("/api/admin/downloads/save", { id: id, title: document.getElementById("dl-title").value.trim(), category: document.getElementById("dl-cat").value, url: document.getElementById("dl-url").value.trim(), description: document.getElementById("dl-desc").value.trim(), info: document.getElementById("dl-info").value.trim() }).then(function (r) {
      if (r.ok) { msg.textContent = id ? "Cambios guardados." : "Descarga agregada."; dlReset(); loadDownloads(); } else msg.textContent = r.error || "No se pudo guardar.";
    }).catch(function () { msg.textContent = "No se pudo guardar."; });
  });

  function loadServers() {
    var rows = document.getElementById("sv-rows");
    getJson("/api/servers").then(function (j) {
      var l = j.servers || [];
      rows.innerHTML = l.length ? l.map(function (s, i) {
        var pl = s.online ? (s.players + (s.max ? " / " + s.max : "")) : "—";
        var names = s.online && s.list && s.list.length ? '<tr class="sv-pl"><td colspan="5"><b>Jugadores:</b> ' + s.list.map(function (p) { return esc(p.name || "(sin nombre)") + (p.score || p.score === 0 ? " <small>(" + p.score + ")</small>" : ""); }).join(", ") + "</td></tr>" : "";
        return '<tr><td class="l">' + esc(s.name) + (s.hostname && s.hostname !== s.name ? " <small>" + esc(s.hostname) + "</small>" : "") + "</td><td><code>" + esc(s.address) + "</code></td><td>" + (s.online ? esc(s.map || "—") : "—") + "</td><td>" + pl + '</td><td><span class="sv-st ' + (s.online ? "on" : "off") + '">' + (s.online ? "En línea" : "Sin respuesta") + "</span></td></tr>" + names;
      }).join("") : '<tr><td class="none" colspan="5">Todavía no hay servidores en la lista.</td></tr>';
    }).catch(function () { rows.innerHTML = '<tr><td class="none" colspan="5">No se pudo cargar. Intenta de nuevo.</td></tr>'; });
    // Editor solo para quien tenga permiso de configuración
    getJson("/api/admin/servers").then(function (a) {
      var box = document.getElementById("sv-admin");
      if (!a || a.error || !a.canEdit) { box.hidden = true; return; }
      box.hidden = false;
      document.getElementById("sv-text").value = (a.servers || []).map(function (s) { return s.name + " | " + s.address; }).join("\n");
    }).catch(function () {});
  }
  document.getElementById("sv-save").addEventListener("click", function () {
    var msg = document.getElementById("sv-msg");
    var items = document.getElementById("sv-text").value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
      var i = x.lastIndexOf("|"); return i < 0 ? { name: x, address: "" } : { name: x.slice(0, i).trim(), address: x.slice(i + 1).trim() };
    });
    msg.textContent = "Guardando...";
    api("/api/admin/servers", { servers: items }).then(function (r) {
      if (r && r.ok) { msg.textContent = "Lista guardada."; loadServers(); } else msg.textContent = (r && r.error) || "No se pudo guardar.";
    }).catch(function () { msg.textContent = "No se pudo guardar."; });
  });

  function loadOnline() {
    var rows = document.getElementById("on-rows");
    var lb = document.getElementById("on-login"), card = document.getElementById("on-card");
    if (!me) { lb.hidden = false; card.hidden = true; return; }
    lb.hidden = true; card.hidden = false;
    getJson("/api/online").then(function (j) {
      if (j.error && !j.players) { lb.hidden = false; card.hidden = true; return; }
      var l = j.players || [];
      rows.innerHTML = l.length ? l.map(function (p) {
        return '<tr><td class="l"><a href="#jugador/' + p.id + '">' + esc(p.alias) + "</a>" + (p.staff ? ' <small>(staff)</small>' : "") + "</td><td>" + (p.clanId ? '<a href="#clan/' + p.clanId + '">' + esc(p.clan) + "</a>" : "Sin clan") + "</td><td>" + (p.clanId ? (ROLE_PUB[p.role] || "Miembro") : "—") + "</td><td>" + new Date(p.at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="4">No hay jugadores conectados con su cuenta en este momento.</td></tr>';
    }).catch(function () { rows.innerHTML = '<tr><td class="none" colspan="4">No se pudo cargar la lista.</td></tr>'; });
  }
  var SOC = [["steam", "Steam"], ["discord", "Discord"], ["twitch", "Twitch"], ["youtube", "YouTube"]];
  function fillSocial(prefix, social) {
    SOC.forEach(function (s) {
      var cell = document.getElementById(prefix + s[0]); if (!cell) return;
      cell.textContent = "";
      var v = social && social[s[0]]; if (!v) return;
      if (/^https:\/\//i.test(v)) { var a = document.createElement("a"); a.href = v; a.target = "_blank"; a.rel = "noopener nofollow"; a.textContent = "Ver perfil de " + s[1]; cell.appendChild(a); }
      else cell.textContent = v;
    });
  }
  function loadPlayerProfile(id) {
    var body = document.getElementById("pj-body"), miss = document.getElementById("pj-missing");
    function set(i, v) { document.getElementById(i).textContent = v == null ? "" : v; }
    getJson("/api/player?id=" + encodeURIComponent(id || "")).then(function (j) {
      if (!j.player) { body.hidden = true; miss.hidden = false; set("pj-err", j.error || "Ese jugador no existe."); return; }
      body.hidden = false; miss.hidden = true;
      var p = j.player;
      set("pj-id", p.id); set("pj-alias", p.alias); set("pj-joined", fdate(p.joined));
      fillSocial("pj-", p.social);
      set("pj-w", j.wins); set("pj-l", j.losses);
      var mr = document.getElementById("pj-mail-row"); mr.hidden = !p.email; if (p.email) document.getElementById("pj-mail").href = "mailto:" + p.email;
      var ar = document.getElementById("pj-admin-row"); ar.hidden = !(j.staff); if (j.staff) document.getElementById("pj-admin").href = "#panel/jugador/" + p.id;
      var logo = document.getElementById("pj-logo"); logo.textContent = "Sin logo";
      if (j.clan && j.clan.logo && /^https?:\/\//i.test(j.clan.logo)) { logo.textContent = ""; var im = document.createElement("img"); im.src = j.clan.logo; im.alt = "Logo de " + j.clan.name; logo.appendChild(im); }
      var tb = document.getElementById("pj-teams");
      tb.innerHTML = (j.teams && j.teams.length) ? j.teams.map(function (t) {
        var st = t.status === "inactive" ? "Inactivo" : (ROLE_ES[t.status] || "Miembro");
        return '<tr><td class="l"><a href="#clan/' + t.clanId + '">' + esc(t.clan) + "</a></td><td>" + esc(t.ladder) + "</td><td>" + st + "</td><td>" + (t.joined ? fdate(t.joined) : "—") + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="4">No pertenece a ningún clan.</td></tr>';
      document.getElementById("pj-sanctions").innerHTML = (j.sanctions && j.sanctions.length) ? j.sanctions.map(function (x) {
        var dur = "—";
        if (x.type === "permanent_ban") dur = "Permanente";
        else if (x.endsAt > 0) { var d = Math.max(1, Math.round((x.endsAt - x.at) / 86400000)); dur = d + (d === 1 ? " día" : " días") + " (hasta " + fdate(x.endsAt) + ")"; }
        else if (x.type === "point_loss" && x.pts > 0) dur = "−" + x.pts + (x.pts === 1 ? " victoria" : " victorias");
        else if (x.type === "ladder_suspension" || x.type === "tournament_suspension" || x.type === "temp_disqualification" || x.type === "expulsion") dur = "Sin fecha de término";
        var st = { active: "Vigente", expired: "Cumplida", revoked: "Revocada", annulled: "Revocada" }[x.status] || x.status;
        return "<tr><td>" + fdate(x.at) + "</td><td>" + esc(x.typeLabel) + "</td><td>" + esc(x.reason || "—") + "</td><td>" + (x.complaintId ? "#" + x.complaintId : "—") + "</td><td>" + esc(dur) + "</td><td>" + esc(st) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="6">Sin sanciones.</td></tr>';
    }).catch(function () { body.hidden = true; miss.hidden = false; set("pj-err", "No se pudo cargar el perfil."); });
  }
  function loadPlayers(page) {
    plPage = page;
    getJson("/api/players?page=" + page + "&q=" + encodeURIComponent(plTerm)).then(function (j) {
      if (!j.players) throw new Error();
      plRows.innerHTML = j.players.length ? j.players.map(function (p) {
        return '<tr><td class="l"><a href="#jugador/' + p.id + '">' + esc(p.alias) + "</a></td><td>" + p.id + "</td><td>" + fdate(p.joined) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="3">' + (plTerm ? "No se encontraron jugadores." : "Aún no hay jugadores registrados.") + "</td></tr>";
      var pages = Math.ceil(j.total / j.per);
      plPager.innerHTML = pages > 1 ? pageNumbers(j.page, pages, "pl") : "";
    }).catch(function () { plRows.innerHTML = '<tr><td class="none" colspan="7">No se pudo cargar la lista.</td></tr>'; plPager.innerHTML = ""; });
  }
  plPager.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-pl]");
    if (b) loadPlayers(Number(b.getAttribute("data-pl")));
  });
  document.getElementById("pl-search").addEventListener("submit", function (e) {
    e.preventDefault();
    var term = document.getElementById("pl-q").value.trim();
    if (document.getElementById("pl-type").value === "2") { plTerm = term; loadPlayers(1); return; }
    document.getElementById("q").value = term; document.getElementById("qtype").value = "1";
    location.hash = "#buscar";
    if (term) document.getElementById("search").dispatchEvent(new Event("submit", { cancelable: true }));
  });

  // Validar cuenta
  var vfStatus = document.getElementById("vf-status");
  function vsay(msg, kind) { vfStatus.textContent = msg; vfStatus.className = "search-result " + (kind || ""); }
  document.getElementById("verify").addEventListener("submit", function (e) {
    e.preventDefault();
    var a = document.getElementById("vf-alias").value.trim(), c = document.getElementById("vf-code").value.trim();
    if (!a || !/^\d{6}$/.test(c)) { vsay("Escribe tu nombre y el código de 6 dígitos.", "err"); return; }
    api("/api/verify", { alias: a, code: c }).then(function (r) {
      if (r.ok) { keepValidar = true;
        vsay(r.already ? "Esa cuenta ya estaba validada." : (me ? "¡Cuenta validada! Ya tienes todo habilitado." : "¡Cuenta validada! Ya puedes iniciar sesión."), "ok"); document.getElementById("vf-code").value = ""; loadMe(); }
      else vsay(r.error || "No se pudo validar.", "err");
    }).catch(function () { vsay("No hay conexión con el servidor.", "err"); });
  });
  document.getElementById("vf-resend").addEventListener("click", function () {
    var a = document.getElementById("vf-alias").value.trim();
    if (!a) { vsay("Escribe tu nombre de jugador primero.", "err"); return; }
    api("/api/resend", { alias: a }).then(function (r) {
      vsay(r.ok ? "Si la cuenta existe y falta validarla, enviamos un código nuevo a su email." : (r.error || "No se pudo enviar."), r.ok ? "ok" : "err");
    }).catch(function () { vsay("No hay conexión con el servidor.", "err"); });
  });

  var me = null;
  function refreshMe() { loadMe(); }
  function setPlayer(p) {
    me = p;
    if (typeof ping === "function" && vid) ping();
    if (current === "online") loadOnline();
    if (current === "mi-clan") loadMine();
    if (current === "clan") loadClan(clanId);
    loginForm.hidden = !!p;
    sessionBox.hidden = !p;
    document.getElementById("menu-confirm").hidden = document.getElementById("menu-report").hidden = !(p && p.leader);
    document.getElementById("menu-mi-clan").hidden = !p;
    document.getElementById("menu-new").hidden = !!p;
    document.getElementById("menu-admin").hidden = !(p && p.staff);
    document.getElementById("menu-links").hidden = !(p && p.staff);
    document.getElementById("menu-backup").hidden = !(p && p.staff);
    if (current === "admin") loadAdmin();
    if (current === "panel" && window.LadderPanel) window.LadderPanel.open((location.hash || "").slice(1).split("/"));
    if (!p && current === "panel") location.hash = "#inicio";
    document.getElementById("menu-validate").hidden = !!(p && p.verified);
    if (!p && (current === "mi-clan" || current === "reportar" || current === "confirmar")) location.hash = "#inicio";
    if (p && (current === "reportar" || current === "confirmar")) loadMatchPanels();
    if (p && p.leader) document.getElementById("lb-confirm").textContent = "Confirmar victoria" + (p.toConfirm ? " (" + p.toConfirm + ")" : "");
    if (p) document.getElementById("my-id").textContent = p.id;
    if (p) document.getElementById("who").textContent = p.alias + (p.verified === false ? " (sin validar)" : "") + (p.staff ? " · ADMINISTRADOR" : " · usuario");
  }
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var alias = document.getElementById("pid").value.trim();
    var pass = document.getElementById("pw").value;
    if (!alias || !pass) { loginMsg.textContent = "Escribe tu nombre y contraseña."; return; }
    loginMsg.textContent = "";
    api("/api/login", { alias: alias, password: pass, remember: document.getElementById("rem").checked }).then(function (r) {
      if (r.player) { document.getElementById("pw").value = ""; setPlayer(r.player); refreshMe(); }
      else loginMsg.textContent = r.error || "No se pudo iniciar sesión.";
    }).catch(function () { loginMsg.textContent = "No hay conexión con el servidor."; });
  });
  document.getElementById("logout").addEventListener("click", function () {
    api("/api/logout").then(function () { setPlayer(null); });
  });
  document.getElementById("on-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = document.getElementById("on-msg"), alias = document.getElementById("on-id").value.trim(), pass = document.getElementById("on-pw").value;
    if (!alias || !pass) { msg.textContent = "Escribe tu nombre y contraseña."; return; }
    msg.textContent = "";
    api("/api/login", { alias: alias, password: pass, remember: false }).then(function (r) {
      if (r.player) { document.getElementById("on-pw").value = ""; setPlayer(r.player); refreshMe(); loadOnline(); }
      else msg.textContent = r.error || "No se pudo iniciar sesión.";
    }).catch(function () { msg.textContent = "No hay conexión con el servidor."; });
  });
  function loadMe() {
    fetch("/api/me", { credentials: "same-origin" }).then(function (r) { return r.json(); })
      .then(function (j) { setPlayer(j.player); applyGuards(); }).catch(function () {});
  }
  loadMe();

  var seasonNow = null;
  function curLabel() { return seasonNow ? seasonNow.label : "Sin temporada activa"; }
  function applySeasonLabel() {
    var t = document.getElementById("ladder-title"); if (t) t.textContent = curLabel();
    var mt = document.getElementById("mp-title"); if (mt) mt.textContent = curLabel();
    var c = document.getElementById("cl-ladder"); if (c) c.textContent = curLabel();
  }
  function loadStats() {
    fetch("/api/stats").then(function (r) { return r.json(); }).then(function (j) {
      var el = document.getElementById("stat-players");
      if (el && typeof j.players === "number") el.textContent = j.players;
      var eo = document.getElementById("stat-online"), eg = document.getElementById("stat-guests");
      if (eo && typeof j.online === "number") eo.textContent = j.online;
      if (eg && typeof j.guests === "number") eg.textContent = j.guests;
      var es = document.getElementById("stat-staff");
      if (es && typeof j.staff === "number") es.textContent = j.staff;
      var em = document.getElementById("stat-matches");
      if (em && typeof j.matchesToday === "number") em.textContent = j.matchesToday;
      var ec = document.getElementById("stat-clans");
      if (ec && typeof j.clans === "number") ec.textContent = j.clans;
      seasonNow = j.season || null;
      applySeasonLabel();
    }).catch(function () {});
  }
  loadStats();

  // Presencia: avisamos al servidor cada minuto que esta pestaña sigue abierta.
  var vid = "";
  try { vid = sessionStorage.getItem("vid") || ""; } catch (_) { /* sin almacenamiento */ }
  if (!/^[a-f0-9]{16,32}$/.test(vid)) {
    vid = "";
    for (var vi = 0; vi < 24; vi++) vid += Math.floor(Math.random() * 16).toString(16);
    try { sessionStorage.setItem("vid", vid); } catch (_) { /* sin almacenamiento */ }
  }
  function ping() {
    if (document.hidden) return;
    api("/api/ping", { vid: vid }).then(loadStats).catch(function () {});
  }
  ping();
  setInterval(ping, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) ping(); });


  // Resultados de partidos (base de datos de partidos): más recientes primero, con hora
  var ptPage = 1;
  var ptRows = document.getElementById("pt-rows"), ptPager = document.getElementById("pt-pager");
  function fdatetime(ms) {
    return new Date(ms).toLocaleString("es-CL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  function matchRow(x) {
    return '<tr><td class="l"><a href="#clan/' + x.winnerId + '">' + esc(x.winner) + '</a></td><td><a href="#clan/' + x.loserId + '">' + esc(x.loser) + "</a></td><td>" + fdatetime(x.at) + '</td><td><a href="#partido/' + x.id + '">Ver</a></td><td>' + esc(x.season || curLabel()) + "</td></tr>";
  }
  function loadResults(page) {
    ptPage = page;
    getJson("/api/matches?page=" + page).then(function (j) {
      if (!j.matches) throw new Error();
      ptRows.innerHTML = j.matches.length ? j.matches.map(matchRow).join("") : '<tr><td class="none" colspan="5">Aún no hay partidos jugados.</td></tr>';
      var pages = Math.ceil(j.total / j.per);
      ptPager.innerHTML = pages > 1 ? pageNumbers(j.page, pages, "pt") : "";
    }).catch(function () { ptRows.innerHTML = '<tr><td class="none" colspan="5">No se pudo cargar.</td></tr>'; ptPager.innerHTML = ""; });
  }
  ptPager.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-pt]");
    if (b) loadResults(Number(b.getAttribute("data-pt")));
  });
  // Detalle de un partido
  function loadMatch(id) {
    var body = document.getElementById("pm-body"), msg = document.getElementById("pm-msg");
    msg.textContent = ""; msg.className = "status-line";
    var n = parseInt(id, 10);
    if (!n) { body.innerHTML = ""; msg.textContent = "Elige un partido desde Resultados de partidos."; return; }
    getJson("/api/match?id=" + n).then(function (j) {
      if (!j.match) { body.innerHTML = ""; msg.textContent = j.error || "No se pudo cargar el partido."; msg.className = "status-line err"; return; }
      var w = j.match.winner, l = j.match.loser;
      document.getElementById("pm-title").textContent = (j.match.season || curLabel()) + " Partido";
      function list(a) { return a.length ? a.map(esc).join("<br>") : "—"; }
      function link(s) { return '<a href="#clan/' + s.id + '">' + esc(s.name) + "</a>"; }
      function row(label, a, b) { return '<tr><td class="lbl">' + label + "</td><td>" + a + "</td><td>" + b + "</td></tr>"; }
      body.innerHTML =
        '<tr><td></td><th>Ganador</th><th>Perdedor</th></tr>' +
        row("Nombre", link(w), link(l)) +
        row("Rank", w.rank ? "#" + w.rank : "Sin ranking", l.rank ? "#" + l.rank : "Sin ranking") +
        row("Reportado por", esc(w.by || "—"), esc(l.by || "—")) +
        row("Reportado en", fdatetime(w.at), fdatetime(l.at)) +
        '<tr><td class="gap" colspan="3"></td></tr>' +
        '<tr><td></td><th>Miembros Ganador</th><th>Miembros Perdedor</th></tr>' +
        row("", list(w.members), list(l.members)) +
        '<tr><td class="gap" colspan="3"></td></tr>' +
        (j.match.maps && j.match.maps.length ? '<tr><td class="lbl"><b>Mapas jugados</b></td><td></td><td></td></tr>' + j.match.maps.map(function (n, i) { return '<tr><td class="lbl">#' + (i + 1) + "</td><td>" + esc(n) + "</td><td></td></tr>"; }).join("") + '<tr><td class="gap" colspan="3"></td></tr>' : "") +
        '<tr><td class="lbl"><b>Resultado final</b></td><td></td><td></td></tr>' +
        row("Puntaje final", "1", "0") +
        row("Comentario del partido", w.comment ? esc(w.comment) : "—", l.comment ? esc(l.comment) : "—");
    }).catch(function () { msg.textContent = "No se pudo cargar el partido."; msg.className = "status-line err"; });
  }

  function loadHomeMatches() {
    var ul = document.getElementById("home-matches");
    getJson("/api/matches?page=1").then(function (j) {
      if (!j.matches) return;
      ul.innerHTML = j.matches.length ? j.matches.slice(0, 5).map(function (x) {
        return '<li><a href="#clan/' + x.winnerId + '">' + esc(x.winner) + '</a> venció a <a href="#clan/' + x.loserId + '">' + esc(x.loser) + "</a></li>";
      }).join("") : '<li class="none">Aún no hay partidos jugados.</li>';
    }).catch(function () {});
  }

  var CS_ES = { received: "Recibida", pending: "Pendiente", investigating: "En investigación", insufficient: "Evidencia insuficiente", confirmed: "Infracción confirmada", rejected: "Rechazada", closed: "Cerrada" };
  function loadHomeComplaints() {
    var ul = document.getElementById("home-complaints");
    getJson("/api/denuncias-recientes").then(function (j) {
      if (!j.complaints) return;
      ul.innerHTML = j.complaints.length ? j.complaints.map(function (c) {
        return '<li>#' + c.id + ' · <a href="#jugador/' + c.accusedId + '">' + esc(c.accused) + "</a> · " + esc(CS_ES[c.status] || c.status) + " · " + fdate(c.at) +
          (c.sanction ? '<br><span class="cmp-san">Sanción: ' + esc(c.sanction.type) + " (" + esc(c.sanction.status) + ")</span>" : "") + "</li>";
      }).join("") : '<li class="none">Aún no hay denuncias.</li>';
    }).catch(function () {});
  }

  // Lista de clanes (Ladder Team Database): orden alfabético, números de página y buscador debajo
  var csPage = 1, csTerm = "";
  var csRows = document.getElementById("cs-rows"), csPager = document.getElementById("cs-pager");
  function pageNumbers(page, pages, attr) {
    attr = attr || "cs";
    var show = {}, i;
    if (pages <= 30) { for (i = 1; i <= pages; i++) show[i] = 1; }
    else { [1, 2, 3, pages - 2, pages - 1, pages].forEach(function (n) { show[n] = 1; }); for (i = page - 3; i <= page + 3; i++) if (i >= 1 && i <= pages) show[i] = 1; }
    var out = "", last = 0;
    Object.keys(show).map(Number).sort(function (x, y) { return x - y; }).forEach(function (n) {
      if (n - last > 1) out += "<span>…</span> ";
      out += n === page ? "<b>[" + n + "]</b> " : '<button type="button" class="linkbtn" data-' + attr + '="' + n + '">' + n + "</button> ";
      last = n;
    });
    return out;
  }
  function loadClanList(page) {
    csPage = page;
    getJson("/api/clans?sort=name&page=" + page + "&q=" + encodeURIComponent(csTerm)).then(function (j) {
      if (!j.clans) throw new Error();
      csRows.innerHTML = j.clans.length ? j.clans.map(function (c) {
        var web = c.website ? '<a class="weblink" href="' + esc(c.website) + '" target="_blank" rel="noopener nofollow"><img src="/img/web.svg" width="16" height="16" alt=""> Sitio web</a>' : "";
        return '<tr><td class="l"><a href="#clan/' + c.id + '">' + esc(c.name) + "</a></td><td>" + c.id + "</td><td>" + esc(c.tag) + '</td><td title="' + fdate(c.created) + '">' + fshort(c.created) + "</td><td>" + (c.leaderId ? '<a href="#jugador/' + c.leaderId + '" title="Ver al líder y sus datos de contacto"><img src="/img/mail.svg" width="16" height="12" alt="Contactar al líder"></a>' : "") + "</td><td>" + web + "</td><td>" + esc(curLabel()) + "</td></tr>";
      }).join("") : '<tr><td class="none" colspan="7">' + (csTerm ? "No se encontraron clanes." : "Aún no hay clanes inscritos.") + "</td></tr>";
      var pages = Math.ceil(j.total / j.per);
      csPager.innerHTML = pages > 1 ? pageNumbers(j.page, pages) : "";
    }).catch(function () { csRows.innerHTML = '<tr><td class="none" colspan="7">No se pudo cargar la lista.</td></tr>'; csPager.innerHTML = ""; });
  }
  csPager.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-cs]");
    if (b) loadClanList(Number(b.getAttribute("data-cs")));
  });
  document.getElementById("cs-search").addEventListener("submit", function (e) {
    e.preventDefault();
    var term = document.getElementById("cs-q").value.trim();
    if (document.getElementById("cs-type").value === "1") { csTerm = term; loadClanList(1); return; }
    document.getElementById("q").value = term; document.getElementById("qtype").value = "2";
    location.hash = "#buscar";
    if (term) document.getElementById("search").dispatchEvent(new Event("submit", { cancelable: true }));
  });

  // Perfil de clan
  var clanId = 0, clanData = null;
  var clMsg = document.getElementById("cl-msg");
  var ROLE_EN = { leader: "Leader", coleader: "Co-Leader", captain: "Captain", member: "Member" };
  var ROLE_ES = { leader: "Líder", coleader: "Colíder", captain: "Capitán", member: "Miembro" };
  function setText(id, v) { document.getElementById(id).textContent = v; }
  function loadClan(id, okMsg) {
    clanId = id;
    var n = parseInt(id, 10);
    clMsg.textContent = okMsg || ""; clMsg.className = "status-line" + (okMsg ? " ok" : "");
    if (!n) {
      setText("cl-name", "—"); document.getElementById("cl-members").innerHTML = ""; document.getElementById("cl-manage").hidden = true;
      clMsg.textContent = "Elige un clan desde el ladder o la lista de clanes."; return;
    }
    getJson("/api/clan?id=" + n).then(function (j) {
      if (!j.clan) { clMsg.textContent = j.error || "No se pudo cargar el clan."; clMsg.className = "status-line err"; document.getElementById("cl-members").innerHTML = ""; document.getElementById("cl-manage").hidden = true; return; }
      var c = j.clan; clanData = j;
      setText("cl-name", c.name); setText("cl-id", c.id); setText("cl-tag", c.tag || "—");
      setText("cl-date", fdate(c.created)); setText("cl-last", c.lastMatch ? fdate(c.lastMatch) : "—");
      var web = document.getElementById("cl-web"); web.textContent = "";
      if (c.website) { var a = document.createElement("a"); a.href = c.website; a.target = "_blank"; a.rel = "noopener nofollow"; a.textContent = "Ir a página web del clan"; web.appendChild(a); }
      var lg = document.getElementById("cl-logo"); lg.textContent = "Sin logo";
      if (c.logo) {
        var img = document.createElement("img"); img.alt = "Logo de " + c.name; img.referrerPolicy = "no-referrer";
        img.onload = function () { lg.textContent = ""; lg.appendChild(img); };
        img.src = c.logo;
      }
      var cups = ["", "oro", "plata", "bronce"], cupNames = ["", "1.er lugar", "2.º lugar", "3.er lugar"];
      var tc = document.getElementById("cl-trophies-card");
      tc.hidden = !(c.trophies && c.trophies.length);
      document.getElementById("cl-trophies").innerHTML = (c.trophies || []).map(function (t) {
        return '<li><img src="' + cupSrc(cups[t.place]) + '" width="16" height="13" alt="Copa de ' + cups[t.place] + '"> <a href="#temporada/' + t.seasonId + '">' + esc(t.season) + "</a> — " + cupNames[t.place] + "</li>";
      }).join("");
      var g = c.wins + c.losses;
      setText("cl-w", c.wins); setText("cl-l", c.losses); setText("cl-g", g); setText("cl-p", (g ? Math.round(c.wins * 100 / g) : 0) + "%"); setText("cl-s", c.streak);
      var un = document.getElementById("cl-unranked"), ri = c.rankInfo || {};
      un.hidden = !c.unranked;
      if (c.unranked) un.textContent = "Clan sin ranking (unranked): tiene " + (ri.members || 0) + " de " + (ri.minMembers || 5) + " jugadores. Aparece al final de la tabla; con la primera victoria confirmada muestra su récord y desde la " + (ri.winsToRank || 2) + "ª victoria entra al ranking y empieza a subir" + (ri.members >= (ri.minMembers || 5) ? " (o al jugar su primer partido, ya que cumple los " + (ri.minMembers || 5) + " jugadores)" : " (o al completar " + (ri.minMembers || 5) + " jugadores y jugar un partido)") + ".";
      var hs = c.hist || {};
      setText("cl-h-now", hs.now || "—"); setText("cl-h-last", hs.last || "—"); setText("cl-h-best", hs.best || "—"); setText("cl-h-worst", hs.worst || "—");
      setText("cl-sb", c.bestStreak || 0); setText("cl-sw", c.worstStreak || 0);
      setText("cl-d", c.lastMatch ? Math.max(0, Math.floor((Date.now() - c.lastMatch) / 86400000)) : 0);
      var lead = j.isLeader;
      document.querySelector("#view-clan .lead-only").hidden = !lead;
      document.getElementById("cl-members").innerHTML = c.members.map(function (m) {
        var act = "";
        if (lead && m.role !== "leader") act = '<button type="button" class="linkbtn" data-act="transfer" data-alias="' + esc(m.alias) + '">Hacer líder</button> · <button type="button" class="linkbtn" data-act="kick" data-alias="' + esc(m.alias) + '">Expulsar</button>';
        return "<tr><td class=\"l\"><a href=\"#jugador/" + m.id + "\">" + esc(m.alias) + "</a></td><td>" + fdatetime(m.joined) + "</td><td>" + (ROLE_EN[m.role] || "Member") + "</td><td>" + m.wins + "</td><td>" + m.losses + "</td>" + (lead ? "<td>" + act + "</td>" : "") + "</tr>";
      }).join("");
      getJson("/api/matches?clan=" + c.id).then(function (mj) {
        var tb = document.getElementById("cl-matches");
        tb.innerHTML = mj.matches && mj.matches.length ? mj.matches.map(function (x) {
          return '<tr><td><a href="#clan/' + x.winnerId + '">' + esc(x.winner) + '</a></td><td><a href="#clan/' + x.loserId + '">' + esc(x.loser) + "</a></td><td>" + fdatetime(x.at) + '</td><td><a class="statlink" href="#partido/' + x.id + '" title="Ver estadísticas del partido" aria-label="Ver estadísticas del partido">&#128459;</a></td></tr>';
        }).join("") : '<tr><td class="none" colspan="4">Aún no hay partidos jugados.</td></tr>';
      }).catch(function () {});
      document.getElementById("cl-manage").hidden = !j.canRecruit;
      document.getElementById("cl-invited").textContent = j.canRecruit && c.invited && c.invited.length ? "Invitaciones pendientes: " + c.invited.join(", ") : "";
    }).catch(function () { clMsg.textContent = "No se pudo cargar el clan."; clMsg.className = "status-line err"; });
  }
  document.getElementById("cl-members").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var act = b.getAttribute("data-act"), alias = b.getAttribute("data-alias");
    ask(act === "kick" ? "¿Expulsar a " + alias + " del clan?" : "¿Traspasar el liderazgo a " + alias + "? Dejarás de ser líder.", act === "kick" ? "Expulsar" : "Traspasar").then(function (yes) {
      if (!yes) return;
      api("/api/clan/" + act, { alias: alias }).then(function (r) {
        if (r.ok) { loadClan(clanId); refreshMe(); } else { clMsg.textContent = r.error || "No se pudo."; clMsg.className = "status-line err"; }
      });
    });
  });
  document.getElementById("cl-invite-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var a = document.getElementById("cl-invite").value.trim();
    if (!/^\d{1,9}$/.test(a)) { clMsg.textContent = "Escribe la ID numérica del jugador."; clMsg.className = "status-line err"; return; }
    api("/api/clan/invite", { playerId: Number(a) }).then(function (r) {
      if (r.ok) { document.getElementById("cl-invite").value = ""; loadClan(clanId, "Invitación enviada a " + r.alias + " (ID " + a + ")."); }
      else { clMsg.textContent = r.error || "No se pudo invitar."; clMsg.className = "status-line err"; }
    });
  });

  // Mi clan
  function mcsay(m, kind) {
    ["mc-msg", "rp-msg", "cf-msg"].forEach(function (id) { var el = document.getElementById(id); el.textContent = m; el.className = "status-line " + (kind || ""); });
  }
  // Reportar derrota / Confirmar victoria: solo líderes, cada opción en su propia pantalla
  function loadMatchPanels() {
    if (!me) return;
    getJson("/api/my").then(function (j) {
      var isLead = !!(j.status === 200 && j.clan && ["leader", "coleader", "captain"].indexOf(j.clan.role) >= 0);
      document.getElementById("rep-form").hidden = !isLead;
      if (!isLead) {
        document.getElementById("mc-confirm-list").innerHTML = '<div class="help">Solo el Líder, Colíder o Capitán de un clan puede usar esta opción.</div>';
        document.getElementById("mc-reported-list").innerHTML = "";
        return;
      }
        renderRepPlayers(j.members || []);
        document.getElementById("mc-confirm-list").innerHTML = j.toConfirm.length ? j.toConfirm.map(function (m) {
          var boxes = (j.members || []).map(function (x) { return '<label><input type="checkbox" value="' + x.id + '"> ' + esc(x.alias) + "</label>"; }).join("");
          return '<div class="mt-item" data-id="' + m.id + '">' +
            '<div><a href="#clan/' + m.clanId + '">' + esc(m.clan) + "</a> (ID " + m.clanId + ") reportó que perdió contra ti el " + fdate(m.at) + ". Su derrota ya está registrada; al confirmar, tu clan suma la victoria.</div>" +
            (m.maps && m.maps.length ? "<div>Mapas jugados: " + m.maps.map(esc).join(" y ") + "</div>" : "") + "<div>Jugaron por ellos: " + (m.players.length ? m.players.map(esc).join(", ") : "—") + "</div>" +
            (m.comment ? "<div>Comentario de ellos: «" + esc(m.comment) + "»</div>" : "") +
            '<fieldset class="checks-box"><legend>Miembros de tu clan: marca a quién se le asigna la victoria</legend><div class="checks">' + boxes + "</div></fieldset>" +
            '<textarea maxlength="300" rows="2" aria-label="Comentario del partido" placeholder="Comentario del partido (opcional)"></textarea>' +
            '<div class="row"><button type="button" data-mt="confirm" data-id="' + m.id + '">Confirmar victoria</button> <button type="button" class="linkbtn" data-mt="reject" data-id="' + m.id + '">Rechazar</button></div></div>';
        }).join("") : '<div class="help">No tienes victorias por confirmar.</div>';
        document.getElementById("mc-reported-list").innerHTML = j.reported.length ? j.reported.map(function (m) {
          return '<div class="help">Contra <a href="#clan/' + m.clanId + '">' + esc(m.clan) + "</a> (ID " + m.clanId + ", " + fdate(m.at) + ') — <button type="button" class="linkbtn" data-mt="cancel" data-id="' + m.id + '">Cancelar</button></div>';
        }).join("") : '<div class="help">No tienes reportes pendientes.</div>';
    }).catch(function () { mcsay("No se pudo cargar.", "err"); });
  }
  var myClan = null;
  function loadMine() {
    var ids = ["mc-login", "mc-invites", "mc-create", "mc-social"];
    ids.concat(["mc-account"]).forEach(function (i) { document.getElementById(i).hidden = true; });
    if (!me) { document.getElementById("mc-login").hidden = false; return; }
    getJson("/api/my").then(function (j) {
      if (j.status !== 200) { document.getElementById("mc-login").hidden = false; return; }
      var pl = j.player;
      if (pl) {
        document.getElementById("mc-account").hidden = false;
        setText("ac-id", pl.id); setText("ac-alias", pl.alias); setText("ac-joined", fdate(pl.joined));
        document.getElementById("mc-social").hidden = false;
        SOC.forEach(function (s) { var f = document.getElementById("so-" + s[0]); if (f && document.activeElement !== f) f.value = (pl.social && pl.social[s[0]]) || ""; });
        setText("ac-w", pl.wins); setText("ac-l", pl.losses);
        var lg2 = document.getElementById("ac-logo"); lg2.textContent = "Sin logo";
        if (pl.logo) { var im2 = document.createElement("img"); im2.alt = "Logo de " + pl.alias; im2.referrerPolicy = "no-referrer"; im2.onload = function () { lg2.textContent = ""; lg2.appendChild(im2); }; im2.src = pl.logo; }
        var isLd = !!(j.clan && j.clan.role === "leader"), canRec = !!(j.clan && (j.clan.role === "leader" || j.clan.role === "coleader"));
        document.getElementById("ac-teams").innerHTML = j.clan
          ? '<tr><td class="l"><a href="#clan/' + j.clan.id + '">' + esc(j.clan.name) + "</a></td><td>" + esc(curLabel()) + "</td><td>" + (ROLE_ES[j.clan.role] || "Miembro") + "</td><td>" + (j.clan.joined ? fdate(j.clan.joined) : "—") + "</td><td>" +
            (isLd ? '<button type="button" class="linkbtn" data-ac="edit">Editor</button> · ' : "") + (canRec ? '<button type="button" class="linkbtn" data-ac="recruit">Reclutar</button> · ' : "") +
            '<button type="button" class="linkbtn" data-ac="leave">Dejar</button></td></tr>'
          : '<tr><td class="none" colspan="5">No perteneces a ningún clan.</td></tr>';
        document.getElementById("ac-recruit").hidden = true;
      }
      var inv = document.getElementById("mc-invite-list");
      document.getElementById("mc-invites").hidden = !(j.invites.length && !j.clan);
      inv.innerHTML = j.invites.map(function (i) {
        return '<li class="none"><a href="#clan/' + i.id + '">' + esc(i.name) + '</a> — <button type="button" class="linkbtn" data-inv="accept" data-id="' + i.id + '">Aceptar</button> · <button type="button" class="linkbtn" data-inv="decline" data-id="' + i.id + '">Rechazar</button></li>';
      }).join("");
      if (j.clan) {
        getJson("/api/clan?id=" + j.clan.id).then(function (cj) {
          if (cj.clan) myClan = cj;
        }).catch(function () {});
      } else document.getElementById("mc-create").hidden = false;
    }).catch(function () { mcsay("No se pudo cargar.", "err"); });
  }
  var soBusy = false;
  document.getElementById("social-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (soBusy) return;
    var body = {}; SOC.forEach(function (s) { body[s[0]] = document.getElementById("so-" + s[0]).value.trim(); });
    soBusy = true;
    api("/api/my/social", body).then(function (r) {
      soBusy = false;
      if (r.ok) { SOC.forEach(function (s) { document.getElementById("so-" + s[0]).value = r.social[s[0]] || ""; }); mcsay("Redes guardadas.", "ok"); }
      else mcsay(r.error || "No se pudieron guardar.", "err");
    }).catch(function () { soBusy = false; mcsay("No hay conexión con el servidor.", "err"); });
  });
  document.getElementById("mc-invite-list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-inv]");
    if (!b) return;
    api("/api/clan/" + b.getAttribute("data-inv"), { clanId: Number(b.getAttribute("data-id")) }).then(function (r) {
      if (r.ok && r.clanId) { mcsay("¡Te uniste al clan!", "ok"); loadMine(); }
      else if (r.ok) loadMine();
      else mcsay(r.error || "No se pudo.", "err");
    });
  });
  function matchClick(e) {
    var b = e.target.closest("button[data-mt]");
    if (!b) return;
    var act = b.getAttribute("data-mt");
    var body = { matchId: Number(b.getAttribute("data-id")) };
    if (act === "confirm") {
      var item = b.closest(".mt-item");
      body.players = checkedIds(item);
      body.comment = item.querySelector("textarea").value.trim();
      if (!body.players.length) { mcsay("Marca al menos un jugador de tu clan que recibirá los puntos.", "err"); return; }
    }
    function send() {
      api("/api/match/" + act, body).then(function (r) {
        if (r.ok) { mcsay(act === "confirm" ? "Victoria confirmada. El ladder ya se actualizó." : act === "reject" ? "Reporte rechazado. La derrota reportada se descontó." : "Reporte cancelado. Se descontó la derrota que habías sumado.", "ok"); loadMatchPanels(); loadStats(); refreshMe(); }
        else mcsay(r.error || "No se pudo.", "err");
      }).catch(function () { mcsay("No hay conexión con el servidor.", "err"); });
    }
    if (act === "confirm") ask("¿Confirmas que tu clan ganó este partido? Se sumará al ladder.", "Confirmar victoria").then(function (yes) { if (yes) send(); });
    else send();
  }
  document.getElementById("view-reportar").addEventListener("click", matchClick);
  document.getElementById("view-confirmar").addEventListener("click", matchClick);
  function checkedIds(root) {
    return Array.prototype.map.call(root.querySelectorAll('input[type="checkbox"]:checked'), function (c) { return Number(c.value); });
  }
  getJson("/api/maps").then(function (j) {
    if (!j.groups) return;
    var all = []; j.groups.forEach(function (g) { all = all.concat(g.maps); });
    all.sort(function (x, y) { return x.localeCompare(y, "es", { sensitivity: "base" }); });
    document.getElementById("mp-list").innerHTML = all.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
    var opts = j.groups.map(function (g) {
      return '<optgroup label="' + esc(g.group) + '">' + g.maps.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("") + "</optgroup>";
    }).join("");
    ["rep-map1", "rep-map2"].forEach(function (id) { document.getElementById(id).insertAdjacentHTML("beforeend", opts); });
  }).catch(function () {});
  var repKey = "";
  function renderRepPlayers(members) {
    var key = members.map(function (x) { return x.id; }).join(",");
    if (key === repKey) return;
    repKey = key;
    document.getElementById("rep-players").innerHTML = members.map(function (x) {
      return '<label><input type="checkbox" value="' + x.id + '"> ' + esc(x.alias) + "</label>";
    }).join("");
  }
  document.getElementById("rep-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var o = document.getElementById("rep-opp").value.trim();
    if (!/^\d{1,9}$/.test(o)) { mcsay("Escribe la ID numérica del clan que te ganó.", "err"); return; }
    var players = checkedIds(document.getElementById("rep-players"));
    if (!players.length) { mcsay("Marca al menos un jugador de tu clan que jugó el partido.", "err"); return; }
    var map1 = document.getElementById("rep-map1").value, map2 = document.getElementById("rep-map2").value;
    if (!map1 || !map2) { mcsay("Elige los dos mapas que se jugaron.", "err"); return; }
    api("/api/match/report", { opponentId: Number(o), players: players, map1: map1, map2: map2, comment: document.getElementById("rep-comment").value.trim() }).then(function (r) {
      if (r.ok) {
        document.getElementById("rep-opp").value = ""; document.getElementById("rep-comment").value = ""; document.getElementById("rep-map1").value = ""; document.getElementById("rep-map2").value = "";
        repKey = ""; mcsay("Derrota reportada: ya se sumó 1 derrota a tu clan. El líder de " + r.opponent + " debe confirmar el partido para que le sumen la victoria.", "ok"); loadMatchPanels();
      } else mcsay(r.error || "No se pudo reportar.", "err");
    }).catch(function () { mcsay("No hay conexión con el servidor.", "err"); });
  });
  function leaveClan() {
    ask("¿Seguro que quieres dejar el clan? Si eres el único miembro, el clan se elimina.", "Dejar el clan").then(function (yes) {
      if (!yes) return;
      api("/api/clan/leave").then(function (r) {
        if (r.ok) { mcsay(r.disbanded ? "El clan fue eliminado." : "Saliste del clan.", "ok"); loadMine(); loadStats(); refreshMe(); }
        else mcsay(r.error || "No se pudo salir.", "err");
      });
    });
  }
  var acRec = document.getElementById("ac-recruit"), viewMC = document.getElementById("view-mi-clan");
  function showEditor(on) {
    document.getElementById("ac-editor").hidden = !on;
    document.getElementById("ac-main").hidden = on;
    viewMC.classList.toggle("editing", on);
  }
  function renderEditor(cj) {
    var c = cj.clan;
    document.getElementById("ed-name").value = c.name; document.getElementById("ed-tag").value = c.tag || "";
    document.getElementById("ed-web").value = c.website || ""; document.getElementById("ed-logo").value = c.logo || "";
    setText("ed-side-name", c.name); setText("ed-side-tag", c.tag || "");
    var box = document.getElementById("ed-logo-box"); box.textContent = "Sin logo";
    if (c.logo) { var im = document.createElement("img"); im.alt = "Logo de " + c.name; im.referrerPolicy = "no-referrer"; im.onload = function () { box.textContent = ""; box.appendChild(im); }; im.src = c.logo; }
    setText("ed-count", c.members.length + (c.members.length === 1 ? " jugador" : " jugadores"));
    document.getElementById("ed-members").innerHTML = c.members.map(function (m) {
      var opts = ["leader", "coleader", "captain", "member"].map(function (r) { return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + ROLE_ES[r] + "</option>"; }).join("");
      return '<tr><td class="l"><b>' + esc(m.alias) + '</b><br><span class="soft">ID ' + m.id + '</span></td><td><select data-pid="' + m.id + '" aria-label="Rango de ' + esc(m.alias) + '">' + opts + '</select></td><td><button type="button" data-kick="' + esc(m.alias) + '"' + (m.role === "leader" ? " disabled" : "") + ">Expulsar</button></td></tr>";
    }).join("");
  }
  function openEditor() {
    if (!myClan || !myClan.clan) return;
    getJson("/api/clan?id=" + myClan.clan.id).then(function (cj) {
      if (!cj.clan) return; myClan = cj; renderEditor(cj); showEditor(true);
    }).catch(function () { mcsay("No se pudo cargar el editor.", "err"); });
  }
  viewMC.addEventListener("click", function (e) {
    var k = e.target.closest("button[data-kick]");
    if (k) {
      var al = k.getAttribute("data-kick");
      ask("¿Expulsar a " + al + " del clan?", "Expulsar").then(function (yes) {
        if (!yes) return;
        api("/api/clan/kick", { alias: al }).then(function (r) {
          if (r.ok) { mcsay("Jugador expulsado.", "ok"); openEditor(); } else mcsay(r.error || "No se pudo expulsar.", "err");
        });
      });
      return;
    }
    var b = e.target.closest("button[data-ac]");
    if (!b) return;
    var act = b.getAttribute("data-ac");
    if (act === "leave") return leaveClan();
    if (act === "edit") { acRec.hidden = true; mcsay("", ""); return openEditor(); }
    if (act === "close") { showEditor(false); acRec.hidden = true; loadMine(); mcsay("", ""); return; }
    acRec.hidden = act !== "recruit";
    if (act === "recruit") {
      var inv = myClan && myClan.clan && myClan.clan.invited;
      document.getElementById("rc-pending").textContent = inv && inv.length ? "Invitaciones pendientes: " + inv.join(", ") : "";
    }
    mcsay("", "");
  });
  document.getElementById("ed-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = function (id) { return document.getElementById(id).value.trim(); };
    if (v("ed-name").length < 3) { mcsay("El nombre del clan debe tener al menos 3 caracteres.", "err"); return; }
    var roles = {};
    document.querySelectorAll("#ed-members select").forEach(function (s) { roles[s.getAttribute("data-pid")] = s.value; });
    api("/api/clan/edit", { name: v("ed-name"), tag: v("ed-tag"), website: v("ed-web"), logo: v("ed-logo"), roles: roles }).then(function (r) {
      if (r.ok) { mcsay("Clan actualizado.", "ok"); loadMine(); refreshMe(); openEditor(); } else mcsay(r.error || "No se pudo guardar.", "err");
    }).catch(function () { mcsay("No hay conexión con el servidor.", "err"); });
  });
  acRec.addEventListener("submit", function (e) {
    e.preventDefault();
    var a = document.getElementById("rc-id").value.trim();
    if (!/^\d{1,9}$/.test(a)) { mcsay("Escribe la ID numérica del jugador.", "err"); return; }
    api("/api/clan/invite", { playerId: Number(a) }).then(function (r) {
      if (r.ok) { document.getElementById("rc-id").value = ""; loadMine(); mcsay("Invitación enviada a " + r.alias + " (ID " + a + ").", "ok"); }
      else mcsay(r.error || "No se pudo invitar.", "err");
    }).catch(function () { mcsay("No hay conexión con el servidor.", "err"); });
  });
  var cfBusy = false;
  document.getElementById("clan-form").addEventListener("submit", function (e) {
    e.preventDefault();
    if (cfBusy) return;
    var v = function (id) { return document.getElementById(id).value.trim(); };
    if (v("cf-name").length < 3) { mcsay("El nombre del clan debe tener al menos 3 caracteres.", "err"); return; }
    cfBusy = true;
    api("/api/clan/create", { name: v("cf-name"), tag: v("cf-tag"), website: v("cf-web"), logo: v("cf-logo") }).then(function (r) {
      cfBusy = false;
      if (r.clan) { document.getElementById("clan-form").reset(); mcsay("", ""); loadStats(); refreshMe(); location.hash = "#clan/" + r.clan.id; }
      else mcsay(r.error || "No se pudo crear el clan.", "err");
    }).catch(function () { cfBusy = false; mcsay("No hay conexión con el servidor.", "err"); });
  });

  showView();
})();
