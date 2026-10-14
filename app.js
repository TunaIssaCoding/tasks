/* Tasks PWA with GitHub-backed sync. ES2017 max (old iPad Safari). No task data ships with this code. */
(function () {
  'use strict';
  var CFG_KEY = 'tasks.cfg', DOC_KEY = 'tasks.doc', META_KEY = 'tasks.meta';
  var FILE = 'tasks.json', NATIVE_MIN = 5000, POLL_MS = 15000;
  var SECTIONS = [{ id: 'today', name: 'Today' }, { id: 'followups', name: 'Follow-ups' }, { id: 'triggers', name: 'Triggers' }, { id: 'longterm', name: 'Long-term' }, { id: 'ideas', name: 'Ideas' }];

  if (!Element.prototype.matches) Element.prototype.matches = Element.prototype.webkitMatchesSelector;
  if (!Element.prototype.closest) Element.prototype.closest = function (s) { var el = this; while (el && el.nodeType === 1) { if (el.matches(s)) return el; el = el.parentNode; } return null; };

  function $(s, r) { return (r || document).querySelector(s); }
  function now() { return Date.now(); }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function todayIso() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function b64decode(s) { return decodeURIComponent(escape(atob(s.replace(/\s/g, '')))); }
  function b64encode(s) { return btoa(unescape(encodeURIComponent(s))); }
  function rid() { return 'web-' + Math.random().toString(36).slice(2, 10); }

  var cfg = load(CFG_KEY, {});
  if (!cfg.deviceId) { cfg.deviceId = rid(); save(CFG_KEY, cfg); }
  if (!cfg.repo) cfg.repo = 'TunaIssaCoding/tasks-data';
  var doc = load(DOC_KEY, null) || { schema: 2, sections: SECTIONS.slice(), tasks: [], updatedAt: 0 };
  var meta = load(META_KEY, { sha: null, dirty: false, lastSync: 0 });
  var ui = { query: '', showHidden: false, open: {}, status: 'idle', msg: '' };
  var syncing = false, again = false, pollTimer = 0, debounce = 0;

  /* ---------- merge (same rules as box CLI) ---------- */
  function wins(a, b) {
    var ua = a.updatedAt || 0, ub = b.updatedAt || 0;
    if (ua !== ub) return ua > ub;
    return String(a.deviceId || '') > String(b.deviceId || '');
  }
  function merge(local, remote) {
    var map = {}, i, t, out = [];
    var rmap = {};
    (remote.tasks || []).forEach(function (r) { rmap[r.id] = r; });
    // renumber local-only new tasks whose id was taken remotely by a different task
    var maxN = NATIVE_MIN - 1;
    (remote.tasks || []).concat(local.tasks || []).forEach(function (x) { if (x.id >= NATIVE_MIN && x.id > maxN) maxN = x.id; });
    (local.tasks || []).forEach(function (l) {
      var r = rmap[l.id];
      if (l._new && r && r.createdAt !== l.createdAt) { maxN += 1; l.id = maxN; l.label = String(maxN); l.updatedAt = now(); }
    });
    (local.tasks || []).forEach(function (l) { map[l.id] = l; });
    (remote.tasks || []).forEach(function (r) {
      var cur = map[r.id];
      if (!cur) map[r.id] = r;
      else if (wins(r, cur)) map[r.id] = r;
      else if (cur._new && !wins(cur, r) === false) { /* keep local */ }
    });
    for (i in map) if (Object.prototype.hasOwnProperty.call(map, i)) { t = map[i]; if (rmap[t.id] && t._new && rmap[t.id].createdAt === t.createdAt) delete t._new; out.push(t); }
    out.sort(function (a, b) { return a.id - b.id; });
    var secs = (local.sections && local.sections.length ? local.sections : SECTIONS).slice();
    (remote.sections || []).forEach(function (s) { if (!secs.some(function (x) { return x.id === s.id; })) secs.push(s); });
    return { schema: 2, sections: secs, tasks: out, updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0) };
  }
  function sameTasks(a, b) {
    function key(d) { return JSON.stringify((d.tasks || []).map(function (t) { return [t.id, t.updatedAt, t.deviceId]; })); }
    return key(a) === key(b);
  }
  function clean(d) {
    return { schema: 2, sections: d.sections, updatedAt: now(), tasks: d.tasks.map(function (t) { var c = {}, k; for (k in t) if (k.charAt(0) !== '_') c[k] = t[k]; return c; }) };
  }

  /* ---------- GitHub contents API ---------- */
  function gh(method, path, body) {
    var url = 'https://api.github.com/repos/' + cfg.repo + '/contents/' + path + (method === 'GET' ? '?ref=main&t=' + now() : '');
    return fetch(url, {
      method: method, cache: 'no-store',
      headers: { 'Authorization': 'token ' + cfg.token, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  async function getRemote() {
    var res = await gh('GET', FILE);
    if (res.status === 404) return { doc: { schema: 2, sections: SECTIONS.slice(), tasks: [] }, sha: null };
    if (!res.ok) { var e = new Error('GET ' + res.status); e.status = res.status; throw e; }
    var j = await res.json();
    return { doc: JSON.parse(b64decode(j.content)), sha: j.sha };
  }

  async function sync() {
    if (!cfg.token) return;
    if (syncing) { again = true; return; }
    syncing = true; setStatus('busy', 'Syncing…');
    try {
      for (var attempt = 0; attempt < 6; attempt++) {
        var r = await getRemote();
        var merged = merge(doc, r.doc);
        var changed = !sameTasks(merged, r.doc);
        doc = merged; save(DOC_KEY, doc); meta.sha = r.sha; render();
        if (!changed) { meta.dirty = false; break; }
        if (!meta.dirty && attempt === 0 && !changed) break;
        var body = { message: 'app edit [' + cfg.deviceId + ']', branch: 'main', content: b64encode(JSON.stringify(clean(doc), null, 1)) };
        if (r.sha) body.sha = r.sha;
        var put = await gh('PUT', FILE, body);
        if (put.ok) {
          var pj = await put.json(); meta.sha = pj.content.sha; meta.dirty = false;
          doc.tasks.forEach(function (t) { delete t._new; }); save(DOC_KEY, doc);
          break;
        }
        if (put.status === 409 || put.status === 422 || put.status >= 500) { await new Promise(function (ok) { setTimeout(ok, 400 * (attempt + 1)); }); continue; }
        var e = new Error('PUT ' + put.status); e.status = put.status; throw e;
      }
      meta.lastSync = now(); save(META_KEY, meta);
      setStatus('ok', 'Synced ' + new Date(meta.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      save(META_KEY, meta);
      if (err.status === 401 || err.status === 403) setStatus('err', 'Token rejected (' + err.status + ')');
      else if (err.status === 404) setStatus('err', 'Repo not found');
      else setStatus('err', (navigator.onLine === false ? 'Offline' : 'Sync failed') + (meta.dirty ? ' · ' + pending() + ' queued' : ''));
    } finally {
      syncing = false;
      if (again) { again = false; sync(); }
    }
  }
  function pending() { return doc.tasks.filter(function (t) { return (t.updatedAt || 0) > (meta.lastSync || 0); }).length; }
  function schedule(ms) { clearTimeout(debounce); debounce = setTimeout(sync, ms == null ? 300 : ms); }
  function poll() { clearTimeout(pollTimer); pollTimer = setTimeout(function () { if (!document.hidden) sync(); poll(); }, POLL_MS); }

  /* ---------- mutations ---------- */
  function byId(id) { id = Number(id); for (var i = 0; i < doc.tasks.length; i++) if (doc.tasks[i].id === id) return doc.tasks[i]; return null; }
  function touch(t) { t.updatedAt = now(); t.deviceId = cfg.deviceId; meta.dirty = true; save(DOC_KEY, doc); save(META_KEY, meta); render(); schedule(); }
  function addTask(raw, section) {
    raw = raw.trim(); if (!raw) return;
    var room = '', text = raw, m = raw.match(/^([^:]{1,60}):\s+(.+)$/);
    if (m) { room = m[1].trim(); text = m[2].trim(); }
    var max = NATIVE_MIN - 1; doc.tasks.forEach(function (t) { if (t.id > max && t.id >= NATIVE_MIN) max = t.id; });
    var ts = now();
    var t = { id: max + 1, label: String(max + 1), section: section, room: room, text: text, note: '', done: false, deleted: false, hidden: false, source: 'app', createdAt: ts, updatedAt: ts, deviceId: cfg.deviceId, _new: true };
    doc.tasks.push(t); touch(t);
  }
  function isHidden(t) { return !!t.hidden && (!t.hideUntilDate || t.hideUntilDate > todayIso()); }
  function parseDate(s) { var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : null; }

  /* ---------- rendering ---------- */
  function setStatus(kind, msg) { ui.status = kind; ui.msg = msg; var el = $('#sync'); if (el) { el.className = 'sync ' + kind; el.textContent = msg; } }
  function toast(msg) { var el = $('#toast'); if (!el) return; el.textContent = msg; el.className = 'toast show'; clearTimeout(toast.t); toast.t = setTimeout(function () { el.className = 'toast'; }, 3000); }

  function renderSetup(error) {
    var app = $('#app');
    app.innerHTML = '<div class="setup"><h1>Connect Tasks</h1>' +
      '<p>Paste a GitHub token with access to the private data repo. It is stored only in this browser (localStorage) and sent only to api.github.com.</p>' +
      '<label for="tok">GitHub token</label><input class="input" id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<label for="repo">Data repo (owner/name)</label><input class="input" id="repo" autocapitalize="off" spellcheck="false" value="' + esc(cfg.repo) + '">' +
      '<p class="err" id="setupErr">' + esc(error || '') + '</p>' +
      '<button class="btn primary" id="connect">Connect</button> ' + (cfg.token ? '<button class="btn" id="cancelSetup">Cancel</button> <button class="btn" id="forget">Forget token</button>' : '') + '</div>';
    $('#connect').onclick = async function () {
      var tok = $('#tok').value.trim() || cfg.token, repo = $('#repo').value.trim();
      if (!tok) { $('#setupErr').textContent = 'Token required'; return; }
      var old = { token: cfg.token, repo: cfg.repo };
      cfg.token = tok; cfg.repo = repo;
      $('#setupErr').textContent = 'Checking…';
      try {
        await getRemote();
        if (old.repo !== repo) { doc = { schema: 2, sections: SECTIONS.slice(), tasks: [], updatedAt: 0 }; meta = { sha: null, dirty: false, lastSync: 0 }; }
        save(CFG_KEY, cfg); start();
      } catch (e) {
        cfg.token = old.token; cfg.repo = old.repo;
        $('#setupErr').textContent = e.status ? 'GitHub said ' + e.status + (e.status === 404 ? ' (repo not found or token lacks access)' : '') : 'Network error';
      }
    };
    if ($('#cancelSetup')) $('#cancelSetup').onclick = start;
    if ($('#forget')) $('#forget').onclick = function () { localStorage.removeItem(CFG_KEY); localStorage.removeItem(DOC_KEY); localStorage.removeItem(META_KEY); location.reload(); };
  }

  function renderShell() {
    $('#app').innerHTML =
      '<header class="top"><div class="row1"><h1>Tasks</h1><span class="count" id="count"></span><span class="spacer"></span>' +
      '<span class="sync" id="sync"></span><button class="btn small" id="syncNow" title="Sync now">↻</button> <button class="btn small" id="settings" title="Settings">⚙</button></div>' +
      '<form class="add" id="add" autocomplete="off"><input class="input" id="addText" placeholder="New task (Room: text)"><select class="select" id="addSec"></select><button class="btn primary">Add</button></form>' +
      '<div class="tools"><input class="input" id="q" type="search" placeholder="Search"><label><input type="checkbox" id="showHidden"> hidden</label></div></header>' +
      '<main id="list"></main><div class="toast" id="toast"></div>';
    $('#addSec').innerHTML = doc.sections.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
    $('#add').onsubmit = function (e) { e.preventDefault(); addTask($('#addText').value, $('#addSec').value); $('#addText').value = ''; };
    $('#q').oninput = function () { ui.query = this.value.toLowerCase(); render(); };
    $('#showHidden').onchange = function () { ui.showHidden = this.checked; render(); };
    $('#syncNow').onclick = function () { sync(); };
    $('#settings').onclick = function () { renderSetup(''); };
    $('#list').addEventListener('click', onListClick);
    $('#list').addEventListener('change', onListChange);
    setStatus(ui.status === 'idle' ? 'busy' : ui.status, ui.msg || 'Loading…');
  }

  function taskHtml(t) {
    var cls = 'task' + (t.done ? ' done' : '') + (isHidden(t) ? ' hid' : '') + (ui.open[t.id] ? ' open' : '');
    var metaBits = [];
    if (isHidden(t)) metaBits.push('hidden until ' + (t.hideUntil || t.hideUntilDate));
    if (t.logged) metaBits.push('logged ' + t.logged);
    return '<li class="' + cls + '" data-id="' + t.id + '"><input type="checkbox"' + (t.done ? ' checked' : '') + ' aria-label="Done #' + esc(t.label || t.id) + '">' +
      '<div class="body"><span class="badge">#' + esc(t.label || t.id) + '</span>' + (t.room ? '<span class="room">' + esc(t.room) + ':</span> ' : '') + '<span class="txt">' + esc(t.text) + '</span>' +
      (metaBits.length ? '<span class="meta">' + esc(metaBits.join(' · ')) + '</span>' : '') +
      '<div class="note">' + esc(t.note || '') + '</div>' +
      '<div class="acts"><button class="btn small" data-act="edit">Edit</button><button class="btn small" data-act="note">Note</button>' +
      '<button class="btn small" data-act="hide">' + (isHidden(t) ? 'Unhide' : 'Hide until…') + '</button><button class="btn small" data-act="move">Move</button><button class="btn small" data-act="del">Delete</button></div></div></li>';
  }

  function render() {
    var list = $('#list'); if (!list) return;
    var q = ui.query, active = 0, hiddenN = 0;
    var html = doc.sections.map(function (s) {
      var ts = doc.tasks.filter(function (t) { return !t.deleted && t.section === s.id; });
      var vis = ts.filter(function (t) {
        if (isHidden(t) && !t.done) { hiddenN++; if (!ui.showHidden) return false; }
        if (!q) return true;
        return ('#' + (t.label || t.id) + ' ' + (t.room || '') + ' ' + t.text + ' ' + (t.note || '')).toLowerCase().indexOf(q) !== -1;
      });
      var open = vis.filter(function (t) { return !t.done; }), done = vis.filter(function (t) { return t.done; });
      active += open.length;
      done.sort(function (a, b) { return (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt); });
      if (!open.length && !done.length) return '';
      return '<section class="sec"><h2>' + esc(s.name) + ' <span>' + open.length + '</span></h2><ul>' + open.map(taskHtml).join('') + '</ul>' +
        (done.length ? '<details' + (q ? ' open' : '') + '><summary>Done (' + done.length + ')</summary><ul>' + done.map(taskHtml).join('') + '</ul></details>' : '') + '</section>';
    }).join('');
    list.innerHTML = html || '<p class="empty">No tasks.</p>';
    $('#count').textContent = active + ' open' + (hiddenN ? ' · ' + hiddenN + ' hidden' : '');
  }

  function onListChange(e) {
    if (e.target.type !== 'checkbox') return;
    var t = byId(e.target.closest('li').getAttribute('data-id')); if (!t) return;
    t.done = e.target.checked; if (t.done) t.doneAt = now(); else delete t.doneAt;
    touch(t);
  }
  function onListClick(e) {
    var li = e.target.closest('li.task'); if (!li || e.target.type === 'checkbox') return;
    var t = byId(li.getAttribute('data-id')); if (!t) return;
    var btn = e.target.closest('button'), act = btn && btn.getAttribute('data-act'), v;
    if (!act) { ui.open[t.id] = !ui.open[t.id]; render(); return; }
    if (act === 'edit') { v = prompt('Edit task', (t.room ? t.room + ': ' : '') + t.text); if (v != null && v.trim()) { var m = v.trim().match(/^([^:]{1,60}):\s+(.+)$/); if (m) { t.room = m[1].trim(); t.text = m[2].trim(); } else { t.room = ''; t.text = v.trim(); } touch(t); } }
    else if (act === 'note') { v = prompt('Note', t.note || ''); if (v != null) { t.note = v; touch(t); } }
    else if (act === 'hide') {
      if (isHidden(t)) { t.hidden = false; delete t.hideUntil; delete t.hideUntilDate; touch(t); }
      else { v = prompt('Hide until (YYYY-MM-DD or a trigger)', ''); if (v != null && v.trim()) { t.hidden = true; t.hideUntil = v.trim(); var d = parseDate(v); if (d) t.hideUntilDate = d; else delete t.hideUntilDate; touch(t); } }
    }
    else if (act === 'move') { v = prompt('Move to section: ' + doc.sections.map(function (s) { return s.id; }).join(', '), t.section); if (v && doc.sections.some(function (s) { return s.id === v.trim(); })) { t.section = v.trim(); touch(t); } }
    else if (act === 'del') { if (confirm('Delete #' + (t.label || t.id) + '?')) { t.deleted = true; touch(t); toast('Deleted #' + (t.label || t.id)); } }
  }

  /* ---------- boot ---------- */
  var wired = false;
  function start() {
    if (!cfg.token) { renderSetup(''); return; }
    renderShell(); render(); sync(); poll();
    if (!wired) {
      wired = true;
      document.addEventListener('visibilitychange', function () { if (!document.hidden && cfg.token) sync(); });
      window.addEventListener('online', function () { if (cfg.token) sync(); });
      window.addEventListener('focus', function () { if (cfg.token) schedule(100); });
    }
  }
  window.__tasks = { sync: sync, state: function () { return { doc: doc, meta: meta, ui: ui }; } };
  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('./sw.js').catch(function () {}); });
  start();
})();
