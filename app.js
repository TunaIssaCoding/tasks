/* GitHub-backed Tasks PWA. Classic script; retain older Safari syntax. */
(function () {
  'use strict';

  var demo = !!(window.location && window.location.hash === '#demo');
  var storagePrefix = demo ? 'tasks-demo:v2:' : '';
  var CFG_KEY = 'tasks.cfg', DOC_KEY = 'tasks.doc', OLD_META_KEY = 'tasks.meta', UI_KEY = 'tasks.ui';
  CFG_KEY = storagePrefix + CFG_KEY;
  DOC_KEY = storagePrefix + DOC_KEY;
  OLD_META_KEY = storagePrefix + OLD_META_KEY;
  UI_KEY = storagePrefix + UI_KEY;
  var netFails = 0;
  var NATIVE_MIN = 5000, POLL_MS = 15000;
  var SECTIONS = [
    { id: 'today', name: 'Today' },
    { id: 'followups', name: 'Follow-ups' },
    { id: 'triggers', name: 'Triggers' },
    { id: 'longterm', name: 'Long-term' },
    { id: 'ideas', name: 'Ideas' }
  ];

  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.webkitMatchesSelector;
  }
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (selector) {
      var el = this;
      while (el && el.nodeType === 1) {
        if (el.matches(selector)) return el;
        el = el.parentNode;
      }
      return null;
    };
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function now() { return Date.now(); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function load(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
      }[c];
    });
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }
  function parseDate(value) {
    var s = String(value).trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    var year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    var d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    d.setUTCHours(0, 0, 0, 0);
    return d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? s : null;
  }
  function shortTitle(value) {
    var s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (s.length <= 70) return s;
    var cut = s.slice(0, 70);
    var space = cut.lastIndexOf(' ');
    if (space >= 40) cut = cut.slice(0, space);
    return cut.trim();
  }
  function taskWho(t) {
    if (t.who && typeof t.who === 'object' && t.who.kind) return t.who;
    var match = /^(chase|waiting):(.+)$/.exec(String(t.owner || '').trim());
    if (!match) return { kind: 'me' };
    var name = match[2].trim();
    if (!name || (match[1] === 'chase' && /^(you|tuna|patrick|me)$/i.test(name))) return { kind: 'me' };
    return { kind: match[1], name: name };
  }
  function taskWhen(t) {
    if (t.when && typeof t.when === 'object' && t.when.kind) return t.when;
    if (t.hidden) {
      if (t.hideUntilDate) return { kind: 'date', date: t.hideUntilDate };
      return { kind: 'event', event: t.hideUntil || 'Trigger not named' };
    }
    if (t.section === 'today') return { kind: 'today' };
    if (t.section === 'triggers') return { kind: 'event', event: t.trigger || 'Trigger not named' };
    if (t.section === 'longterm' || t.section === 'ideas') return { kind: 'later' };
    return { kind: 'next' };
  }
  function taskKind(t) {
    return t.kind === 'task' || t.kind === 'idea' ? t.kind : t.section === 'ideas' ? 'idea' : 'task';
  }
  function taskView(t) {
    var view = {};
    Object.keys(t).forEach(function (key) { view[key] = t[key]; });
    view.who = taskWho(t);
    view.when = taskWhen(t);
    view.kind = taskKind(t);
    view.whoSince = doc.schema === 3 ? (t.whoSince || 0) : (t.updatedAt || 0);
    return view;
  }
  function whoToOwner(who) {
    var name = String(who.name || '').trim();
    return (who.kind === 'chase' || who.kind === 'waiting') && name ? who.kind + ':' + name : 'you';
  }
  /* Keep the CLI's schema-2 write semantics, including its trigger-section case. */
  function applyWhenSchema2(t, when) {
    var kind = when.kind;
    if (kind === 'today' || kind === 'next' || kind === 'later') {
      if (kind !== 'later' || t.section !== 'ideas') {
        t.section = kind === 'today' ? 'today' : kind === 'next' ? 'followups' : 'longterm';
        t.sectionManual = true;
      }
      t.hidden = false;
      delete t.hideUntil;
      delete t.hideUntilDate;
    } else if (kind === 'date') {
      t.hidden = true;
      t.hideUntil = when.date;
      t.hideUntilDate = when.date;
    } else if (kind === 'event') {
      var event = when.event || 'Trigger not named';
      if (t.section === 'triggers') {
        if (event !== 'Trigger not named') t.trigger = event;
        else delete t.trigger;
        t.triggerManual = true;
      } else {
        t.hidden = true;
        t.hideUntil = event;
        delete t.hideUntilDate;
      }
    }
  }
  function b64decode(value) {
    return decodeURIComponent(escape(atob(value.replace(/\s/g, ''))));
  }
  function b64encode(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }
  function deviceId() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return 'web-' + Array.prototype.map.call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    }
    return 'web-' + now().toString(36) + '-' +
      Math.random().toString(36).slice(2);
  }
  function emptyDoc() {
    return { schema: 2, sections: clone(SECTIONS), tasks: [], updatedAt: 0 };
  }
  function validateDoc(value) {
    if (!value || (value.schema !== undefined && value.schema !== 2 && value.schema !== 3) ||
        (value.schema !== 3 && !Array.isArray(value.sections)) || !Array.isArray(value.tasks)) {
      throw new Error('Invalid tasks.json schema');
    }
    var ids = Object.create(null);
    value.tasks.forEach(function (t) {
      if (!t || !Number.isSafeInteger(t.id) || t.id < 0 || ids[t.id]) {
        throw new Error('Invalid or duplicate task ID');
      }
      ids[t.id] = true;
    });
    return value;
  }

  /*
   * Canonical comparison ignores local-only bookkeeping and document
   * updatedAt. Section changes and all public task fields remain significant.
   */
  function publicTask(task) {
    var result = {};
    Object.keys(task).forEach(function (key) {
      if (key.charAt(0) !== '_') result[key] = task[key];
    });
    return result;
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      var result = {};
      Object.keys(value).sort().forEach(function (key) {
        result[key] = canonical(value[key]);
      });
      return result;
    }
    return value;
  }
  function taskKey(task) {
    return JSON.stringify(canonical(publicTask(task)));
  }
  function clean(value) {
    var result = clone(value);
    result.tasks = value.tasks.map(publicTask);
    if (value.schema === 3) {
      delete result.sections;
      result.tasks.forEach(function (t) {
        ['section', 'sectionManual', 'owner', 'trigger', 'triggerManual',
          'hidden', 'hideUntil', 'hideUntilDate'].forEach(function (key) { delete t[key]; });
      });
    }
    return result;
  }
  function sameDoc(a, b) {
    var left = clean(a), right = clean(b);
    delete left.updatedAt;
    delete right.updatedAt;
    return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  }
  function taskMap(value) {
    var result = Object.create(null);
    value.tasks.forEach(function (t) { result[t.id] = t; });
    return result;
  }

  var cfg = load(CFG_KEY, {});
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
  var credentialCleanupFailed = false;
  if (Object.prototype.hasOwnProperty.call(cfg, 'token')) {
    delete cfg.token;
    try { save(CFG_KEY, cfg); } catch (e) {
      try { localStorage.removeItem(CFG_KEY); } catch (ignored) {
        credentialCleanupFailed = true;
      }
    }
  }
  if (!cfg.deviceId) cfg.deviceId = deviceId();
  var doc = emptyDoc();
  var meta = freshMeta();
  var ui = freshUi();
  var syncing = false, again = false, pollTimer = 0, debounce = 0;
  var storageError = '';
  var active = false, closing = false, generation = 0;
  var controller = null, syncPromise = null, lockPromise = null;
  var prepared = null, pendingModule = null, cacheUnavailable = false;
  var editor = null, focusId = null, relativeTimer = 0;

  function freshMeta() {
    return { sha: null, dirty: false, lastSync: 0, base: emptyDoc() };
  }
  function freshUi() {
    return {
      query: '', ownerFilter: 'all', roomFilter: '', tab: 'tasks', datesCollapsed: true,
      collapsedTriggers: {}, open: {}, status: 'idle', msg: ''
    };
  }
  function cacheModule() {
    if (!pendingModule) pendingModule = import('./auth/pending.js');
    return pendingModule;
  }
  function scope() {
    var parts = cfg.repo.split('/');
    return { owner: parts[0], repo: parts[1], path: cfg.path, branch: cfg.branch };
  }
  function isCurrent(epoch) {
    return active && epoch === generation;
  }
  function assertCurrent(epoch) {
    if (!isCurrent(epoch)) throw new Error('Task session ended');
  }
  function persistUi() {
    if (!active || closing) return;
    try {
      save(UI_KEY, {
        query: ui.query,
        roomFilter: ui.roomFilter,
        tab: ui.tab,
        datesCollapsed: ui.datesCollapsed,
        ownerFilter: ui.ownerFilter,
        collapsedTriggers: ui.collapsedTriggers
      });
    } catch (e) {}
    persist();
  }
  function collapseState() {
    return { datesCollapsed: ui.datesCollapsed, collapsedTriggers: ui.collapsedTriggers };
  }

  function pending() {
    var base = taskMap(meta.base);
    return doc.tasks.filter(function (t) {
      return !base[t.id] || taskKey(t) !== taskKey(base[t.id]);
    }).length;
  }
  function updateDirty() {
    meta.dirty = !sameDoc(doc, meta.base);
  }
  function persist() {
    if (!active) return false;
    updateDirty();
    try {
      /*
       * Document and acknowledgement baseline are one localStorage write.
       * A crash cannot leave a new edit paired with an old "clean" flag.
       */
      save(DOC_KEY, {
        repo: cfg.repo, path: cfg.path, branch: cfg.branch, doc: doc, meta: meta, view: collapseState()
      });
      storageError = '';
      return true;
    } catch (e) {
      storageError = 'Browser storage failed; edits are not saved offline';
      setStatus('err', storageError);
      return false;
    }
  }

  /* ---------- merge ---------- */

  function wins(a, b) {
    var ta = a.updatedAt || 0, tb = b.updatedAt || 0;
    if (ta !== tb) return ta > tb;
    return String(a.deviceId || '') > String(b.deviceId || '');
  }
  function sameCreation(local, remote) {
    if (local.createdAt !== remote.createdAt ||
        local.source !== remote.source) return false;
    /*
     * While a creation is unacknowledged, its original writer distinguishes
     * simultaneous creations sharing a millisecond.
     */
    if (local._new) {
      return String(remote.deviceId || '') ===
        String(local._creator || local.deviceId || '');
    }
    return true;
  }
  function merge(local, remote) {
    if ((local.schema === 3) !== (remote.schema === 3)) {
      var error = new Error('Task schema changed; pending edits are preserved. Reconcile them before syncing the migrated board.');
      error.code = 'SCHEMA_CHANGED';
      throw error;
    }
    var remoteMap = taskMap(remote), map = Object.create(null);
    var next = NATIVE_MIN - 1;
    var localTasks = local.tasks.map(clone);

    localTasks.concat(remote.tasks).forEach(function (t) {
      if (t.id >= NATIVE_MIN && t.id > next) next = t.id;
    });
    localTasks.forEach(function (t) {
      var r = remoteMap[t.id];
      if (t._new && r && !sameCreation(t, r)) {
        next += 1;
        t.id = next;
        t.label = String(next);
      } else if (t._new && r && sameCreation(t, r)) {
        delete t._new;
        delete t._creator;
      }
      map[t.id] = t;
    });
    remote.tasks.forEach(function (r) {
      var current = map[r.id];
      /* Exact LWW ties use the fetched remote record. */
      if (!current || !wins(current, r)) map[r.id] = clone(r);
    });

    var result = clone(remote);
    if (remote.schema === 3) {
      delete result.sections;
    } else {
      var sections = clone(remote.sections);
      var sectionIds = Object.create(null);
      sections.forEach(function (s) { sectionIds[s.id] = true; });
      local.sections.forEach(function (s) {
        if (!sectionIds[s.id]) {
          sections.push(clone(s));
          sectionIds[s.id] = true;
        }
      });
      result.sections = sections;
    }
    result.tasks = Object.keys(map).map(function (id) { return map[id]; })
      .sort(function (a, b) { return a.id - b.id; });
    result.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
    return result;
  }

  /* ---------- GitHub contents API ---------- */

  function apiError(method, status) {
    var e = new Error(method + ' ' + status);
    e.status = status;
    return e;
  }
  function gh(epoch, method, path, body) {
    assertCurrent(epoch);
    return fetch('https://api.github.com/repos/' + cfg.repo + path, {
      method: method,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      /* Stable URLs + no cache-buster so the browser can reuse the CORS preflight; no-store prevents stale reads. */
      headers: body ? {
        'Authorization': 'token ' + cfg.token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      } : {
        'Authorization': 'token ' + cfg.token,
        'Accept': 'application/vnd.github+json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  function contentPath() {
    return '/contents/' + cfg.path.split('/').map(encodeURIComponent).join('/');
  }
  async function getRemote(epoch) {
    var res = await gh(epoch, 'GET', contentPath() + '?ref=' + encodeURIComponent(cfg.branch));
    assertCurrent(epoch);
    if (res.status === 404) {
      /* A missing file is not evidence that this private repo is accessible. */
      var repoResponse = await gh(epoch, 'GET', '');
      assertCurrent(epoch);
      if (!repoResponse.ok) throw apiError('GET', repoResponse.status);
      return { doc: emptyDoc(), sha: null };
    }
    if (!res.ok) throw apiError('GET', res.status);
    var entry = await res.json();
    assertCurrent(epoch);
    var content = entry.content;
    if (!content && entry.size > 0) {
      var blobResponse = await gh(epoch, 'GET', '/git/blobs/' + entry.sha);
      assertCurrent(epoch);
      if (!blobResponse.ok) throw apiError('GET blob', blobResponse.status);
      var blob = await blobResponse.json();
      assertCurrent(epoch);
      content = blob.content;
    }
    return {
      doc: validateDoc(JSON.parse(b64decode(content))),
      sha: entry.sha
    };
  }
  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }
  function acknowledge(published) {
    var acknowledged = taskMap(published);
    doc.tasks.forEach(function (t) {
      var sent = acknowledged[t.id];
      if (t._new && sent &&
          t.createdAt === sent.createdAt && t.source === sent.source) {
        delete t._new;
        delete t._creator;
      }
    });
  }
  function sync(flushing) {
    if (demo) {
      setStatus('idle', 'Demo · not synced');
      return Promise.resolve();
    }
    if (!active || !cfg.token || (closing && flushing !== true)) return Promise.resolve();
    if (syncing) {
      again = true;
      return syncPromise;
    }
    syncing = true;
    syncPromise = runSync(generation);
    return syncPromise;
  }
  async function runSync(epoch) {
    setStatus('busy', 'Syncing…');
    try {
      var completed = false;
      for (var attempt = 0; attempt < 6; attempt++) {
        assertCurrent(epoch);
        var remote = await getRemote(epoch);
        assertCurrent(epoch);

        /*
         * Read the live document after GET resolves. Edits during GET are
         * included; merge never mutates either input.
         */
        doc = meta.dirty ? merge(doc, remote.doc) : clone(remote.doc);
        meta.base = clean(remote.doc);
        meta.sha = remote.sha;
        persist();
        render();

        if (sameDoc(doc, remote.doc)) {
          completed = true;
          break;
        }

        /* This immutable snapshot, not the subsequently edited doc, is sent. */
        var published = clean(doc);
        published.updatedAt = Math.max(now(), published.updatedAt || 0);
        var body = {
          message: 'app edit [' + cfg.deviceId + ']',
          branch: cfg.branch,
          content: b64encode(JSON.stringify(published, null, 1))
        };
        if (remote.sha) body.sha = remote.sha;
        var response = await gh(epoch, 'PUT', contentPath(), body);
        assertCurrent(epoch);

        if (response.ok) {
          var result = await response.json();
          assertCurrent(epoch);
          meta.base = published;
          if (!result || !result.content || !result.content.sha) throw apiError('PUT', response.status);
          meta.sha = result.content.sha;
          acknowledge(published);

          /*
           * Preserve edits made after the snapshot. Their versions exceed the
           * sent versions; they remain dirty against the published baseline.
           */
          doc = merge(doc, published);
          completed = true;
          break;
        }
        if (response.status === 409 || response.status === 422 ||
            response.status >= 500) {
          try { await response.text(); } catch (ignore) { /* drain so old Safari frees the connection */ }
          assertCurrent(epoch);
          if (attempt < 5) await delay(400 * (attempt + 1));
          assertCurrent(epoch);
          continue;
        }
        throw apiError('PUT', response.status);
      }
      if (!completed) throw new Error('Repeated sync conflicts');

      netFails = 0;
      meta.lastSync = now();
      persist();
      render();
      if (storageError) {
        setStatus('err', storageError);
      } else if (meta.dirty) {
        setStatus('busy', pending() + ' queued');
        again = true;
      } else {
        setStatus('ok', relativeSync());
      }
    } catch (err) {
      if (!isCurrent(epoch)) return;
      persist();
      if (storageError) {
        setStatus('err', storageError);
      } else if (err.code === 'SCHEMA_CHANGED') {
        setStatus('err', err.message);
      } else if (err.status === 401 || err.status === 403) {
        setStatus('err', 'Token rejected (' + err.status + ')');
      } else if (err.status === 404) {
        setStatus('err', 'Repo not found or token lacks access');
      } else {
        /* Network/CORS blip (GitHub occasionally 405s a preflight): retry soon with backoff. */
        netFails = Math.min(netFails + 1, 5); schedule(2000 * netFails);
        setStatus('err',
          (navigator.onLine === false ? 'Offline' : 'Sync failed') +
          (meta.dirty ? ' · ' + pending() + ' queued' : ''));
      }
    } finally {
      if (isCurrent(epoch)) {
        syncing = false;
        syncPromise = null;
        if (again) {
          again = false;
          schedule(300);
        }
      }
    }
  }
  function schedule(ms) {
    if (!active || closing) return;
    clearTimeout(debounce);
    var epoch = generation;
    debounce = setTimeout(function () {
      if (isCurrent(epoch)) sync();
    }, ms == null ? 300 : ms);
  }
  function poll() {
    if (!active || closing) return;
    clearTimeout(pollTimer);
    var epoch = generation;
    pollTimer = setTimeout(function () {
      if (!isCurrent(epoch) || closing) return;
      if (!document.hidden) sync();
      poll();
    }, POLL_MS);
  }

  /* ---------- mutations ---------- */

  function byId(id) {
    id = Number(id);
    for (var i = 0; i < doc.tasks.length; i++) {
      if (doc.tasks[i].id === id) return doc.tasks[i];
    }
    return null;
  }
  /* A no-op edit must not win LWW. */
  function taskSig(t) {
    var c = {}, k;
    for (k in t) if (k !== 'updatedAt' && k !== 'deviceId' && k.charAt(0) !== '_') c[k] = t[k];
    return JSON.stringify(canonical(c));
  }
  function touch(t, before) {
    if (!active || closing) return;
    if (before != null && taskSig(t) === before) return;
    t.updatedAt = Math.max(now(), (t.updatedAt || 0) + 1);
    t.deviceId = cfg.deviceId;
    doc.updatedAt = Math.max(doc.updatedAt || 0, t.updatedAt);
    persist();
    render();
    if (syncing) again = true;
    schedule();
  }
  function addTask(raw) {
    if (!active || closing) return;
    raw = raw.trim();
    if (!raw) return;
    var room = '', text = raw;
    var match = /^([^:]{1,60}):\s+(.+)$/.exec(raw);
    if (match) {
      room = match[1].trim();
      text = match[2].trim();
    }
    var max = NATIVE_MIN - 1;
    doc.tasks.forEach(function (t) {
      if (t.id >= NATIVE_MIN && t.id > max) max = t.id;
    });
    var ts = now();
    var task = {
      id: max + 1,
      label: String(max + 1),
      room: room,
      text: text,
      title: shortTitle(text || raw),
      titleAuto: true,
      detail: raw,
      note: '',
      tags: [],
      done: false,
      deleted: false,
      source: 'app',
      createdAt: ts,
      updatedAt: ts,
      deviceId: cfg.deviceId,
      _new: true,
      _creator: cfg.deviceId
    };
    if (doc.schema === 3) {
      task.who = { kind: 'me' };
      task.when = { kind: 'today' };
      task.kind = 'task';
      task.whoSince = ts;
    } else {
      task.section = 'today';
      task.owner = whoToOwner({ kind: 'me' });
      task.hidden = false;
    }
    doc.tasks.push(task);
    touch(task);
  }
  function changeTask(t, field, value) {
    if (!active || closing || !t || t.deleted) return false;
    var before = taskSig(t), schema3 = doc.schema === 3;
    if (field === 'who') {
      if (!value || !/^(me|chase|waiting)$/.test(value.kind)) return false;
      var who = { kind: value.kind };
      if (who.kind !== 'me') {
        who.name = String(value.name || '').trim();
        if (!who.name) return false;
      }
      if (JSON.stringify(canonical(taskWho(t))) === JSON.stringify(canonical(who))) return true;
      if (schema3) { t.who = who; t.whoSince = now(); }
      else t.owner = whoToOwner(who);
    } else if (field === 'when') {
      if (!value || !/^(today|next|later|date|event)$/.test(value.kind)) return false;
      var when = { kind: value.kind };
      if (when.kind === 'date') {
        when.date = parseDate(value.date);
        if (!when.date) { toast('Invalid calendar date'); return false; }
      }
      if (when.kind === 'event') {
        when.event = String(value.event || '').trim();
        if (!when.event) return false;
      }
      if (JSON.stringify(canonical(taskWhen(t))) === JSON.stringify(canonical(when))) return true;
      if (schema3) { t.when = when; t.whenManual = true; }
      else applyWhenSchema2(t, when);
    } else if (field === 'kind') {
      if (value !== 'task' && value !== 'idea') return false;
      if (schema3) {
        t.kind = value; t.when = { kind: 'later' }; t.whenManual = true;
      } else {
        t.section = value === 'idea' ? 'ideas' : 'longterm';
        t.sectionManual = true;
        applyWhenSchema2(t, { kind: 'later' });
      }
    } else if (field === 'title') {
      if (String(value) === (t.title || t.text || '')) return true;
      value = shortTitle(value);
      if (!value) return false;
      if (value === (t.title || t.text || '')) return true;
      t.title = value; t.titleAuto = false;
    } else if (field === 'note' || field === 'room') {
      if (String(t[field] || '') === String(value)) return true;
      t[field] = String(value);
    } else return false;
    touch(t, before);
    return true;
  }

  /* ---------- drag ---------- */

  var drag = {
    active: false,
    press: false,
    pointerId: null,
    kind: '',
    id: null,
    li: null,
    ghost: null,
    startX: 0,
    startY: 0,
    x: 0,
    y: 0,
    raf: 0,
    scrollRaf: 0,
    target: null,
    timer: 0,
    before: null
  };
  var swallowClick = false;

  function isInteractive(el) {
    return !!(el && el.closest('button,input,select,textarea,label,a'));
  }
  function pointFromTouch(e) {
    var t = e.changedTouches && e.changedTouches[0];
    if (!t && e.touches) t = e.touches[0];
    return t ? { x: t.clientX, y: t.clientY } : null;
  }
  function clearDropTarget() {
    if (drag.target) {
      drag.target.className = drag.target.className.replace(/\s*drop-target/g, '');
      drag.target = null;
    }
  }
  function setDropTarget(sec) {
    if (sec === drag.target) return;
    clearDropTarget();
    if (sec) {
      drag.target = sec;
      if ((' ' + sec.className + ' ').indexOf(' drop-target ') === -1) {
        sec.className += ' drop-target';
      }
    }
  }
  function dragSectionAt(x, y) {
    var el = document.elementFromPoint(x, y);
    var group = el && el.closest ? el.closest('.tgroup[data-trigger]') : null;
    if (group) return group;
    var sec = el && el.closest ? el.closest('.sec[data-when]') : null;
    return sec;
  }
  function updateGhost() {
    drag.raf = 0;
    if (!drag.active || !drag.ghost) return;
    drag.ghost.style.webkitTransform = 'translate3d(' + drag.x + 'px,' + drag.y + 'px,0)';
    drag.ghost.style.transform = 'translate3d(' + drag.x + 'px,' + drag.y + 'px,0)';
    setDropTarget(dragSectionAt(drag.x, drag.y));
  }
  function scheduleGhost() {
    if (!drag.raf) drag.raf = requestAnimationFrame(updateGhost);
  }
  function autoScroll() {
    var h = window.innerHeight || document.documentElement.clientHeight || 0;
    var edge = 60, speed = 0;
    if (drag.active && h) {
      if (drag.y < edge) speed = -Math.ceil((edge - drag.y) / edge * 18);
      else if (drag.y > h - edge) speed = Math.ceil((drag.y - (h - edge)) / edge * 18);
      if (speed) { window.scrollBy(0, speed); scheduleGhost(); }
    }
    if (drag.active) drag.scrollRaf = requestAnimationFrame(autoScroll);
    else drag.scrollRaf = 0;
  }
  function startDrag() {
    if (!drag.press || drag.active || !drag.li) return;
    var t = byId(drag.id);
    if (!t || t.deleted) return;
    drag.active = true;
    drag.before = taskSig(t);
    document.body.className +=
      (document.body.className ? ' ' : '') + 'dragging';
    drag.li.className += ' dragging-source';
    drag.ghost = drag.li.cloneNode(true);
    drag.ghost.className += ' drag-ghost';
    drag.ghost.style.left = '0';
    drag.ghost.style.top = '0';
    drag.ghost.style.width = drag.li.offsetWidth + 'px';
    drag.ghost.style.webkitTransform = 'translate3d(' + drag.x + 'px,' + drag.y + 'px,0)';
    drag.ghost.style.transform = 'translate3d(' + drag.x + 'px,' + drag.y + 'px,0)';
    document.body.appendChild(drag.ghost);
    if (navigator.vibrate && drag.kind !== 'mouse') navigator.vibrate(10);
    scheduleGhost();
    if (!drag.scrollRaf) drag.scrollRaf = requestAnimationFrame(autoScroll);
  }
  function onTargetTouchMove(e) { e.stopPropagation(); touchMove(e); }
  function onTargetTouchEnd(e) {
    e.stopPropagation();
    if (drag.press && drag.kind === 'touch') finishDrag(e.type === 'touchcancel');
  }
  function unbindTouchTarget() {
    var el = drag.touchEl;
    if (!el) return;
    drag.touchEl = null;
    el.removeEventListener('touchmove', onTargetTouchMove, { passive: false });
    el.removeEventListener('touchend', onTargetTouchEnd);
    el.removeEventListener('touchcancel', onTargetTouchEnd);
  }
  function resetDrag() {
    var wasActive = drag.active;
    unbindTouchTarget();
    clearTimeout(drag.timer);
    if (drag.raf) cancelAnimationFrame(drag.raf);
    if (drag.scrollRaf) cancelAnimationFrame(drag.scrollRaf);
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    if (drag.li) drag.li.className = drag.li.className.replace(/\s*dragging-source/g, '');
    document.body.className = document.body.className.replace(/\s*dragging/g, '');
    clearDropTarget();
    drag.active = false;
    drag.press = false;
    drag.pointerId = null;
    drag.kind = '';
    drag.id = null;
    drag.li = null;
    drag.ghost = null;
    drag.raf = 0;
    drag.scrollRaf = 0;
    drag.timer = 0;
    drag.before = null;
    if (wasActive) render();
  }
  function finishDrag(cancel) {
    var wasActive = drag.active;
    var target = drag.target;
    var id = drag.id;
    var kind = target && target.getAttribute('data-when');
    var event = target && target.getAttribute('data-trigger');
    resetDrag();
    if (!wasActive) return;
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 350);
    if (cancel || !target) return;
    var t = byId(id);
    if (!t || t.deleted) return;
    if (event != null) changeTask(t, 'when', { kind: 'event', event: event });
    else if (kind === 'date' || kind === 'event') openEditor(t, kind);
    else if (kind) changeTask(t, 'when', { kind: kind });
  }
  function beginPress(li, x, y, kind, pointerId) {
    if (!active || closing) return;
    if (drag.press || drag.active) resetDrag();
    drag.press = true;
    drag.pointerId = pointerId;
    drag.kind = kind;
    drag.id = li.getAttribute('data-id');
    drag.li = li;
    drag.startX = x;
    drag.startY = y;
    drag.x = x;
    drag.y = y;
    if (kind !== 'mouse') {
      drag.timer = setTimeout(startDrag, 250);
    }
  }
  function movePress(x, y, e) {
    if (!drag.press) return;
    drag.x = x;
    drag.y = y;
    var dx = x - drag.startX, dy = y - drag.startY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (drag.active) {
      if (e && e.cancelable) e.preventDefault();
      scheduleGhost();
      return;
    }
    if (drag.kind === 'mouse') {
      if (dist > 5) startDrag();
    } else if (dist > 8) {
      resetDrag();
    }
  }
  function pointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    var li = e.target.closest && e.target.closest('li.task');
    if (!li || isInteractive(e.target)) return;
    /* Touch uses touch events (non-passive touchmove) so a long-press drag can block scrolling on iOS. */
    if (e.pointerType === 'touch') return;
    beginPress(li, e.clientX, e.clientY,
      e.pointerType === 'mouse' || !e.pointerType ? 'mouse' : 'touch',
      e.pointerId);
  }
  function pointerMove(e) {
    if (!drag.press || drag.pointerId !== e.pointerId) return;
    movePress(e.clientX, e.clientY, e);
  }
  function pointerUp(e) {
    if (!drag.press || drag.pointerId !== e.pointerId) return;
    finishDrag(false);
  }
  function touchStart(e) {
    if (e.touches && e.touches.length > 1) return;
    var li = e.target.closest && e.target.closest('li.task');
    var p = pointFromTouch(e);
    if (!li || !p || isInteractive(e.target)) return;
    beginPress(li, p.x, p.y, 'touch', null);
    /* Listen on the touched node itself so moves still arrive if it gets detached. */
    drag.touchEl = e.target;
    e.target.addEventListener('touchmove', onTargetTouchMove, { passive: false });
    e.target.addEventListener('touchend', onTargetTouchEnd);
    e.target.addEventListener('touchcancel', onTargetTouchEnd);
  }
  function touchMove(e) {
    var p = pointFromTouch(e);
    if (!p) return;
    movePress(p.x, p.y, e);
  }
  function mouseMove(e) {
    if (!drag.press || drag.kind !== 'mouse') return;
    movePress(e.clientX, e.clientY, e);
  }
  function mouseUp() {
    if (!drag.press || drag.kind !== 'mouse') return;
    finishDrag(false);
  }
  var dragWired = false;
  function wireDrag() {
    var list = $('#list');
    if (!list) return;
    list.addEventListener('touchstart', touchStart, { passive: true });
    list.addEventListener(window.PointerEvent ? 'pointerdown' : 'mousedown', pointerDown);
    if (dragWired) return;
    dragWired = true;
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', function () { if (drag.press && drag.kind === 'touch') finishDrag(false); });
    document.addEventListener('touchcancel', function () { if (drag.press && drag.kind === 'touch') finishDrag(true); });
    if (window.PointerEvent) {
      document.addEventListener('pointermove', pointerMove);
      document.addEventListener('pointerup', pointerUp);
      document.addEventListener('pointercancel', function (e) {
        if (drag.press && drag.pointerId === e.pointerId) finishDrag(true);
      });
    } else {
      document.addEventListener('mousemove', mouseMove);
      document.addEventListener('mouseup', mouseUp);
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && drag.press) finishDrag(true);
    });
    document.addEventListener('click', function (e) {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /* ---------- rendering ---------- */

  function relativeSync() {
    var minutes = Math.max(0, Math.floor((now() - meta.lastSync) / 60000));
    if (!minutes) return 'Synced just now';
    if (minutes < 60) return 'Synced ' + minutes + ' min ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return 'Synced ' + hours + ' hr ago';
    return 'Synced ' + Math.floor(hours / 24) + ' days ago';
  }
  function refreshSyncTime() {
    clearTimeout(relativeTimer);
    if (!active) return;
    if (!demo && ui.status === 'ok' && meta.lastSync) setStatus('ok', relativeSync());
    relativeTimer = setTimeout(refreshSyncTime, 30000);
  }
  function setStatus(kind, message) {
    if (!active) return;
    ui.status = kind;
    ui.msg = message;
    var el = $('#sync');
    if (el) {
      el.className = 'sync ' + kind;
      el.textContent = message;
      el.title = !demo && meta.lastSync ? new Date(meta.lastSync).toLocaleString() : '';
    }
  }
  function toast(message, undo) {
    var el = $('#toast');
    if (!el) return;
    el.innerHTML = '<span>' + esc(message) + '</span>' +
      (undo ? ' <button type="button" class="btn small" id="toastUndo">Undo</button>' : '');
    el.className = 'toast show';
    clearTimeout(toast.timer);
    if (undo) $('#toastUndo').onclick = function () {
      if (!active || closing) return;
      clearTimeout(toast.timer);
      el.className = 'toast';
      el.innerHTML = '';
      undo();
    };
    toast.timer = setTimeout(function () {
      el.className = 'toast';
      el.innerHTML = '';
    }, undo ? 6000 : 3000);
  }
  function updateOwnerChips() {
    var wrap = $('#ownerFilters');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('.chip'), function (chip) {
      chip.className = 'chip' +
        (chip.getAttribute('data-owner') === ui.ownerFilter ? ' active' : '');
    });
  }
  function renderShell() {
    if (!active) return;
    $('#app').innerHTML =
      (demo ? '<div class="demo-banner">Demo · fictional tasks · changes stay in this browser ' +
        '<a href="./">Leave demo</a></div>' : '') +
      '<header class="top"><div class="row1"><h1>Tasks</h1>' +
      '<span class="count" id="count"></span><span class="spacer"></span>' +
      '<span class="sync" id="sync"></span>' +
      '<button class="btn small" id="searchButton" aria-label="Search tasks (/)" title="Search (/)">⌕</button>' +
      '<button class="btn small" id="moreButton" aria-label="More options" aria-expanded="false">⋯</button>' +
      '<button class="btn small" id="lock-button" data-tasks-lock title="Lock Tasks">Lock</button>' +
      '</div><div id="moreMenu" class="more-menu" hidden>' +
      '<details><summary>View</summary><button class="btn small" id="viewDates">Toggle scheduled dates</button></details>' +
      '<button class="btn small" id="syncNow">Sync now</button> ' +
      '<button class="btn small" data-tasks-settings>Settings</button> ' +
      '<button class="btn small" id="helpButton">Help</button>' +
      (demo ? ' <button class="btn small" id="resetDemo">Reset demo</button>' : '') +
      '</div><section id="helpPanel" class="help-panel" aria-label="Keyboard shortcuts" hidden>' +
      '<strong>Keyboard shortcuts</strong><button class="btn small" id="helpClose">Close</button>' +
      '<p>j / k · Move between visible tasks<br>Enter · Expand focused task<br>' +
      '/ · Search<br>? · Help<br>Esc · Close editor, menu or help</p>' +
      '<p>Changes save automatically. Esc closes the editor.</p>' +
      '</section><form class="add" id="add" autocomplete="off">' +
      '<input class="input" id="addText" aria-label="Add a task" placeholder="Add a task (Room: task works too)">' +
      '<button class="btn primary">Add</button></form>' +
      '<div class="tools" id="searchTools" hidden><input class="input" id="q" type="search" ' +
      'aria-label="Search tasks" placeholder="Search tasks"></div>' +
      '<div class="chips" id="ownerFilters">' +
      '<button type="button" class="chip" data-owner="all">Everyone</button>' +
      '<button type="button" class="chip" data-owner="me">My move</button>' +
      '<button type="button" class="chip" data-owner="chase">Chasing</button>' +
      '<button type="button" class="chip" data-owner="waiting">Waiting</button>' +
      '<select class="select" id="roomFilter" aria-label="Filter by room"></select></div>' +
      '<nav id="tabs" class="tabs" aria-label="Task views">' +
      '<button type="button" data-tab="tasks">Tasks</button>' +
      '<button type="button" data-tab="ideas">Ideas</button>' +
      '<button type="button" data-tab="done">Done this week</button></nav></header><main id="list"></main>' +
      '<div class="toast" id="toast" role="status" aria-live="polite"></div>';

    $('#q').value = ui.query;
    $('#searchTools').hidden = !ui.query;
    $('#add').onsubmit = function (e) {
      e.preventDefault();
      if (!active || closing) return;
      finishEditor(true);
      addTask($('#addText').value);
      $('#addText').value = '';
    };
    $('#q').oninput = function () {
      if (!active || closing) return;
      finishEditor(true);
      ui.query = this.value.toLowerCase();
      persistUi();
      render();
    };
    $('#searchButton').onclick = showSearch;
    $('#roomFilter').onchange = function () {
      var room = this.value;
      finishEditor(true);
      ui.roomFilter = room;
      persistUi();
      render();
    };
    $('#tabs').onclick = function (e) {
      var button = e.target.closest('[data-tab]');
      if (!button || !active || closing) return;
      finishEditor(true);
      ui.tab = button.getAttribute('data-tab');
      persistUi();
      render();
    };
    $('#ownerFilters').onclick = function (e) {
      if (!active || closing) return;
      var button = e.target.closest('button');
      if (!button) return;
      finishEditor(true);
      ui.ownerFilter = button.getAttribute('data-owner');
      persistUi();
      updateOwnerChips();
      render();
    };
    $('#syncNow').onclick = function () { sync(); };
    $('#moreButton').onclick = function () {
      $('#moreMenu').hidden = !$('#moreMenu').hidden;
      this.setAttribute('aria-expanded', String(!$('#moreMenu').hidden));
    };
    $('#viewDates').onclick = function () {
      finishEditor(true);
      ui.datesCollapsed = !ui.datesCollapsed;
      persistUi(); render();
    };
    $('#helpButton').onclick = toggleHelp;
    $('#helpClose').onclick = closePanels;
    if (demo) {
      $('#lock-button').onclick = function () { window.location.href = './'; };
      $('#resetDemo').onclick = resetDemo;
    }
    refreshSyncTime();
    $('#list').addEventListener('click', onListClick);
    $('#list').addEventListener('change', onListChange);
    wireDrag();
    updateOwnerChips();
    setStatus(ui.status === 'idle' ? 'busy' : ui.status, ui.msg || 'Loading…');
  }
  function localDay(value) {
    var d = new Date(value), month = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
  }
  function displayDay(value) {
    return new Date(value + 'T12:00:00').toLocaleDateString(undefined,
      { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function pillHtml(t) {
    if (t.who.kind !== 'chase' && t.who.kind !== 'waiting') return '';
    var since = Number(t.whoSince) || Date.parse(t.whoSince) || now();
    var age = Math.max(0, Math.floor((now() - since) / 86400000));
    return '<span class="owner ' + t.who.kind + (age >= 10 ? ' red' : age >= 5 ? ' amber' : '') +
      '">' + esc((t.who.kind === 'chase' ? 'Chasing ' : 'Waiting on ') + (t.who.name || '') +
      ' · ' + age + 'd') + '</span>';
  }
  function taskHtml(raw) {
    var t = taskView(raw), title = t.title || t.text || '';
    var date = t.when.kind === 'date' && t.when.date;
    return '<li class="task' + (t.done ? ' done' : '') +
      (String(focusId) === String(t.id) ? ' focused' : '') + '" data-id="' + esc(t.id) + '">' +
      '<input type="checkbox"' + (t.done ? ' checked' : '') + ' aria-label="Done #' + esc(t.id) + '">' +
      '<div class="body"><span class="main">' +
      (t.room ? '<span class="room">' + esc(t.room) + ' · </span>' : '') +
      '<span class="txt">' + esc(title) + '</span>' +
      (date ? '<span class="date-tag">' + (date <= localDay(now()) ? 'from ' : '') + esc(displayDay(date)) + '</span>' : '') +
      '</span>' + pillHtml(t) +
      '<button type="button" class="badge" data-act="copy" title="Copy task ID">#' + esc(t.id) + '</button>' +
      (t.detail && t.detail !== title ? '<div class="note">' + esc(t.detail) + '</div>' : '') +
      '</div></li>';
  }
  function triggerGroupsHtml(tasks) {
    var groups = Object.create(null);
    tasks.forEach(function (t) {
      var event = taskView(t).when.event || '';
      if (!groups[event]) groups[event] = [];
      groups[event].push(t);
    });
    return Object.keys(groups).sort().map(function (event) {
      var collapsed = !!ui.collapsedTriggers[event];
      return '<div class="tgroup' + (collapsed ? ' collapsed' : '') + '" data-trigger="' + esc(event) + '">' +
        '<button type="button" class="tgroup-h" aria-expanded="' + !collapsed + '">' +
        '<span class="caret">' + (collapsed ? '▸' : '▾') + '</span><span class="tlabel">' +
        esc(event) + '</span><span class="tcount">' + groups[event].length + '</span></button>' +
        '<ul>' + groups[event].map(taskHtml).join('') + '</ul></div>';
    }).join('');
  }
  function render() {
    if (!active || editor) return;
    var list = $('#list');
    if (!list) return;
    /* Do not detach the touched node while a drag is active. */
    if (drag.active) { drag.renderPending = true; return; }
    var rooms = Object.create(null), openCount = 0, today = localDay(now());
    doc.tasks.forEach(function (raw) {
      var t = taskView(raw);
      if (t.deleted) return;
      if (t.room) rooms[t.room] = true;
      if (!t.done && t.kind !== 'idea') openCount++;
    });
    $('#roomFilter').innerHTML = '<option value="">Room · All rooms</option>' +
      Object.keys(rooms).sort().map(function (room) {
        return '<option value="' + esc(room) + '">' + esc(room) + '</option>';
      }).join('');
    $('#roomFilter').value = ui.roomFilter;
    $('#count').textContent = openCount + ' open';
    Array.prototype.forEach.call($('#tabs').querySelectorAll('[data-tab]'), function (button) {
      var selected = button.getAttribute('data-tab') === ui.tab;
      button.className = selected ? 'active' : '';
      button.setAttribute('aria-current', selected ? 'page' : 'false');
    });
    updateOwnerChips();
    var visible = doc.tasks.filter(function (raw) {
      var t = taskView(raw);
      if (t.deleted || (ui.ownerFilter !== 'all' && t.who.kind !== ui.ownerFilter) ||
          (ui.roomFilter && t.room !== ui.roomFilter)) return false;
      return !ui.query || [t.id, t.title, t.text, t.detail, t.note, t.room, t.who.name,
        t.when.event, (t.tags || []).join(' ')].join(' ').toLowerCase().indexOf(ui.query) !== -1;
    });
    var html = '', filtered = ui.query || ui.ownerFilter !== 'all' || ui.roomFilter;
    if (ui.tab === 'done') {
      var monday = new Date(now()), days = Object.create(null);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
      var end = new Date(monday.getTime()); end.setDate(end.getDate() + 7);
      visible.filter(function (t) {
        var stamp = Number(t.doneAt) || Date.parse(t.doneAt);
        return t.done && stamp >= monday.getTime() && stamp < end.getTime();
      }).sort(function (a, b) {
        return (Number(b.doneAt) || Date.parse(b.doneAt)) - (Number(a.doneAt) || Date.parse(a.doneAt));
      }).forEach(function (t) {
        var day = localDay(Number(t.doneAt) || Date.parse(t.doneAt));
        if (!days[day]) days[day] = [];
        days[day].push(t);
      });
      html = Object.keys(days).sort().reverse().map(function (day) {
        return '<section class="sec" data-day="' + day + '"><h2>' + esc(displayDay(day)) +
          '</h2><ul>' + days[day].map(taskHtml).join('') + '</ul></section>';
      }).join('');
    } else if (ui.tab === 'ideas') {
      html = '<ul>' + visible.filter(function (t) {
        return !t.done && taskView(t).kind === 'idea';
      }).map(taskHtml).join('') + '</ul>';
    } else {
      var groups = { today: [], next: [], event: [], later: [], date: [] };
      visible.forEach(function (raw) {
        var t = taskView(raw), kind = t.when.kind;
        if (t.done || t.kind === 'idea') return;
        if (kind === 'date' && t.when.date <= today) kind = 'today';
        (groups[kind] || groups.next).push(raw);
      });
      groups.date.sort(function (a, b) {
        var x = taskView(a).when.date, y = taskView(b).when.date;
        return x < y ? -1 : x > y ? 1 : 0;
      });
      var names = { today: 'Today', next: 'Next', event: 'After an event', later: 'Later', date: 'On a date' };
      html = ['today', 'next', 'event', 'later', 'date'].map(function (kind) {
        var tasks = groups[kind], collapsed = kind === 'date' && ui.datesCollapsed;
        if (!tasks.length && filtered) return '';
        return '<section class="sec' + (collapsed ? ' dates-collapsed' : '') +
          '" data-when="' + kind + '"><h2>' +
          (kind === 'date' ? '<button type="button" class="dates-toggle" aria-expanded="' + !collapsed + '">' +
          (collapsed ? '▸ ' : '▾ ') : '') + names[kind] + ' <span>' + tasks.length + '</span>' +
          (kind === 'date' ? '</button>' : '') + '</h2>' +
          (kind === 'event' ? triggerGroupsHtml(tasks) : '<ul>' + tasks.map(taskHtml).join('') + '</ul>') +
          '</section>';
      }).join('');
    }
    list.innerHTML = html || '<p class="empty">No tasks.</p>';
  }
  function onListChange(e) {
    if (!active || closing || e.target.type !== 'checkbox') return;
    var li = e.target.closest('li.task'), t = li && byId(li.getAttribute('data-id'));
    if (!t || t.deleted) return;
    if (editor) finishEditor(true);
    t.done = e.target.checked;
    if (t.done) t.doneAt = now();
    else delete t.doneAt;
    touch(t);
  }
  function onListClick(e) {
    if (!active || closing) return;
    var h = e.target.closest('.tgroup-h');
    if (h) {
      var event = h.closest('.tgroup').getAttribute('data-trigger');
      ui.collapsedTriggers[event] = !ui.collapsedTriggers[event];
      persistUi(); render(); return;
    }
    if (e.target.closest('.dates-toggle')) {
      ui.datesCollapsed = !ui.datesCollapsed; persistUi(); render(); return;
    }
    if (e.target.closest('input,select,textarea,.inline-editor')) return;
    var li = e.target.closest('li.task'), t = li && byId(li.getAttribute('data-id'));
    if (!t || t.deleted) return;
    var button = e.target.closest('button');
    if (button && button.getAttribute('data-act') === 'copy') copyId(t.id);
    else openEditor(t);
  }

  function restoreTask(saved) {
    var current = byId(saved.id), restored = clone(saved);
    restored.updatedAt = Math.max(restored.updatedAt || 0, current ? current.updatedAt || 0 : 0);
    if (current) doc.tasks[doc.tasks.indexOf(current)] = restored;
    else doc.tasks.push(restored);
    touch(restored);
  }
  function copyId(id) {
    var text = '#' + id;
    function fallback() {
      var input = document.createElement('textarea');
      input.value = text;
      input.className = 'copy-buffer';
      document.body.appendChild(input);
      input.select();
      var copied = false;
      try { copied = document.execCommand('copy'); } catch (ignore) {}
      document.body.removeChild(input);
      toast(copied ? 'Copied ' + text : 'Copy unavailable · ' + text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied ' + text); }, fallback);
    } else fallback();
  }
  function suggestions(field) {
    var values = Object.create(null);
    doc.tasks.forEach(function (raw) {
      var t = taskView(raw), value = field === 'names' ? t.who.name :
        field === 'events' ? t.when.event : t.room;
      if (!t.deleted && value) values[value] = true;
    });
    return Object.keys(values).sort().map(function (value) {
      return '<option value="' + esc(value) + '"></option>';
    }).join('');
  }
  function editorField(name, label, type, list) {
    return '<label>' + label + '<input class="input" data-field="' + name +
      '" type="' + (type || 'text') + '"' + (list ? ' list="' + list + '"' : '') + '></label>';
  }
  function openEditor(t, action) {
    if (editor) finishEditor(true);
    var view = taskView(t);
    if (view.when.kind === 'date') ui.datesCollapsed = false;
    if (view.when.kind === 'event') delete ui.collapsedTriggers[view.when.event];
    render();
    var li = $('#list li.task[data-id="' + esc(t.id) + '"]');
    if (!li) return;
    var wrap = document.createElement('div'), backdrop = document.createElement('div');
    wrap.className = 'inline-editor';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Edit task #' + t.id);
    backdrop.className = 'editor-backdrop';
    backdrop.onclick = function () { finishEditor(true); };
    li.querySelector('.body').appendChild(backdrop);
    wrap.innerHTML = '<div class="editor-heading"><strong>Edit task #' + esc(t.id) +
      '</strong><button type="button" class="btn" data-act="close" aria-label="Close task editor">Close</button></div>' +
      '<fieldset><legend>Who moves next</legend><div class="segments">' +
      [['me', 'Me'], ['chase', 'Chasing'], ['waiting', 'Waiting on']].map(function (pair) {
        return '<button type="button" data-who="' + pair[0] + '">' + pair[1] + '</button>';
      }).join('') + '</div><div data-extra="who">' + editorField('whoName', 'Name', 'text', 'taskNames') +
      '</div></fieldset><fieldset><legend>When</legend><div class="segments">' +
      [['today', 'Today'], ['next', 'Next'], ['later', 'Later'], ['date', 'On a date…'], ['event', 'After an event…']].map(function (pair) {
        return '<button type="button" data-when-choice="' + pair[0] + '">' + pair[1] + '</button>';
      }).join('') + '</div><div data-extra="date">' + editorField('whenDate', 'Date', 'date') +
      '</div><div data-extra="event">' + editorField('whenEvent', 'Event', 'text', 'taskEvents') +
      '</div></fieldset>' + editorField('room', 'Room', 'text', 'taskRooms') +
      editorField('title', 'Title') +
      '<label>Note<textarea class="input" data-field="note"></textarea></label>' +
      '<datalist id="taskNames">' + suggestions('names') + '</datalist>' +
      '<datalist id="taskEvents">' + suggestions('events') + '</datalist>' +
      '<datalist id="taskRooms">' + suggestions('rooms') + '</datalist>' +
      '<div class="editor-actions">' +
      (view.kind === 'idea' ? '<button type="button" class="btn" data-act="make-task">Make it a task</button>' : '') +
      '<button type="button" class="btn delete" data-act="del">Delete task</button></div>';
    li.querySelector('.body').appendChild(wrap);
    var values = { whoName: view.who.name || '', whenDate: view.when.date || '',
      whenEvent: view.when.event || '', room: view.room || '', title: view.title || view.text || '', note: view.note || '' };
    Object.keys(values).forEach(function (key) { wrap.querySelector('[data-field="' + key + '"]').value = values[key]; });
    if (view.acceptedFrom) {
      var provenance = document.createElement('div'), parts = [];
      if (view.source) parts.push('Proposed by ' + view.source);
      var stamp = view.acceptedAt || view.createdAt;
      if (stamp) parts.push(displayDay(localDay(Number(stamp) || Date.parse(stamp))));
      if (view.tags && view.tags.length) parts.push(view.tags.join(', '));
      parts.push('Reference: ' + view.acceptedFrom);
      provenance.className = 'provenance';
      provenance.textContent = parts.join(' · ');
      wrap.appendChild(provenance);
    }
    editor = { id: t.id, wrap: wrap, backdrop: backdrop, who: view.who.kind,
      when: action === 'date' || action === 'event' ? action : view.when.kind };
    function refreshChoices() {
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-who]'), function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-who') === editor.who));
      });
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-when-choice]'), function (button) {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-when-choice') === editor.when));
      });
      wrap.querySelector('[data-extra="who"]').hidden = editor.who === 'me';
      wrap.querySelector('[data-extra="date"]').hidden = editor.when !== 'date';
      wrap.querySelector('[data-extra="event"]').hidden = editor.when !== 'event';
    }
    wrap.oninput = function (e) { saveEditorField(e.target); };
    wrap.onchange = function (e) { saveEditorField(e.target); };
    wrap.onclick = function (e) {
      var button = e.target.closest('button');
      if (!button || !editor || !active || closing) return;
      t = byId(editor.id);
      if (!t || t.deleted) { finishEditor(false); return; }
      var who = button.getAttribute('data-who'), when = button.getAttribute('data-when-choice');
      var act = button.getAttribute('data-act');
      if (who) {
        editor.who = who; refreshChoices();
        saveEditorField(wrap.querySelector('[data-field="whoName"]'));
        if (who !== 'me') wrap.querySelector('[data-field="whoName"]').focus();
      } else if (when) {
        editor.when = when; refreshChoices();
        if (when === 'date' || when === 'event') {
          var field = wrap.querySelector('[data-field="' + (when === 'date' ? 'whenDate' : 'whenEvent') + '"]');
          saveEditorField(field); field.focus();
        } else changeTask(t, 'when', { kind: when });
      } else if (act === 'close') finishEditor(true);
      else if (act === 'make-task') {
        finishEditor(true); changeTask(t, 'kind', 'task');
      } else if (act === 'del') {
        var saved = clone(t);
        finishEditor(false);
        t.deleted = true; touch(t);
        toast('Deleted #' + t.id, function () { restoreTask(saved); });
      }
    };
    wrap.onkeydown = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishEditor(true); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
        e.preventDefault(); e.stopPropagation(); saveEditorField(e.target);
      }
    };
    refreshChoices();
    wrap.querySelector('[data-field="' + (action === 'date' ? 'whenDate' : action === 'event' ? 'whenEvent' : 'title') + '"]').focus();
  }
  function saveEditorField(input) {
    if (!editor || !input || !active || closing) return;
    var field = input.getAttribute('data-field'), t = byId(editor.id), value = input.value;
    if (!field || !t || t.deleted) return;
    if (field === 'whoName') {
      if (editor.who === 'me') changeTask(t, 'who', { kind: 'me' });
      else if (value.trim()) changeTask(t, 'who', { kind: editor.who, name: value.trim() });
    } else if (field === 'whenDate') {
      if (editor.when === 'date' && value) changeTask(t, 'when', { kind: 'date', date: value });
    } else if (field === 'whenEvent') {
      if (editor.when === 'event' && value.trim()) changeTask(t, 'when', { kind: 'event', event: value.trim() });
    } else changeTask(t, field, value);
  }
  function finishEditor(saveEdit) {
    if (!editor) return;
    if (saveEdit) saveEditorField(document.activeElement);
    var id = editor.id;
    editor = null;
    delete ui.open[id];
    focusId = id;
    render();
  }
  function showSearch() {
    finishEditor(true);
    $('#searchTools').hidden = false;
    $('#q').focus();
  }
  function closePanels() {
    $('#moreMenu').hidden = true;
    $('#moreButton').setAttribute('aria-expanded', 'false');
    $('#helpPanel').hidden = true;
  }
  function toggleHelp() {
    var show = $('#helpPanel').hidden;
    closePanels();
    $('#helpPanel').hidden = !show;
  }
  function keyboard(e) {
    if (!active || closing || (' ' + document.body.className + ' ').indexOf(' auth-blocked ') !== -1) return;
    var target = e.target;
    if (target && (target.isContentEditable ||
        target.closest('input,textarea,select,.inline-editor,[contenteditable]:not([contenteditable="false"])'))) return;
    if (e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return;
    if (e.key === '/') { e.preventDefault(); showSearch(); }
    else if (e.key === '?') { e.preventDefault(); toggleHelp(); }
    else if (e.key === 'Escape') { finishEditor(false); closePanels(); }
    else if (e.key === 'j' || e.key === 'k' || e.key === 'Enter') {
      var rows = Array.prototype.filter.call($('#list').querySelectorAll('li.task'), function (li) {
        return li.getClientRects().length > 0;
      });
      if (!rows.length) return;
      var index = -1;
      rows.forEach(function (li, i) {
        if (li.getAttribute('data-id') === String(focusId)) index = i;
      });
      if (e.key === 'Enter') {
        if (index < 0) return;
        openEditor(byId(focusId));
      } else {
        index = index < 0 ? (e.key === 'j' ? 0 : rows.length - 1) :
          Math.max(0, Math.min(rows.length - 1, index + (e.key === 'j' ? 1 : -1)));
        focusId = rows[index].getAttribute('data-id');
        rows.forEach(function (li) { li.className = li.className.replace(/\s*focused/g, ''); });
        rows[index].className += ' focused';
        rows[index].scrollIntoView({ block: 'nearest' });
      }
      e.preventDefault();
    }
  }
  document.addEventListener('keydown', keyboard);

  /* ---------- authenticated lifecycle ---------- */

  function clearPlaintext() {
    localStorage.removeItem(DOC_KEY);
    localStorage.removeItem(OLD_META_KEY);
    localStorage.removeItem(UI_KEY);
  }
  function snapshot() {
    var records = {};
    records[DOC_KEY] = JSON.stringify({
      repo: cfg.repo, path: cfg.path, branch: cfg.branch, doc: doc, meta: meta, view: collapseState()
    });
    return records;
  }
  function restore(records) {
    if (!records || !records[DOC_KEY]) return;
    var stored = JSON.parse(records[DOC_KEY]);
    if (stored.doc) {
      doc = validateDoc(stored.doc);
      meta = stored.meta || freshMeta();
      if (stored.view) {
        ui.datesCollapsed = stored.view.datesCollapsed !== false;
        ui.collapsedTriggers = stored.view.collapsedTriggers || {};
      }
    } else {
      doc = validateDoc(stored);
      var oldMeta = records[OLD_META_KEY] ? JSON.parse(records[OLD_META_KEY]) : {};
      meta = freshMeta();
      meta.sha = oldMeta.sha || null;
      meta.lastSync = oldMeta.lastSync || 0;
    }
    meta.base = meta.base ? validateDoc(meta.base) : emptyDoc();
    updateDirty();
  }
  function prepare() {
    if (demo) return Promise.resolve();
    if (prepared) return prepared;
    prepared = prepareCache().catch(function (error) {
      prepared = null;
      throw error;
    });
    return prepared;
  }
  async function prepareCache() {
    if (credentialCleanupFailed) {
      throw new Error('Browser storage prevented removal of the old connection. Unlock is blocked.');
    }
    var raw, oldMeta;
    try {
      raw = localStorage.getItem(DOC_KEY);
      oldMeta = localStorage.getItem(OLD_META_KEY);
      localStorage.removeItem(UI_KEY);
    } catch (error) {
      throw new Error('Browser storage is inaccessible. Existing offline edits cannot be protected.');
    }
    if (!raw && !oldMeta) return;
    try {
      var stored = raw ? JSON.parse(raw) : {};
      var repository = stored.repo || cfg.repo || 'TunaIssaCoding/tasks-data';
      var parts = repository.split('/');
      var location = {
        owner: parts[0], repo: parts[1],
        path: stored.path || cfg.path || 'tasks.json',
        branch: stored.branch || cfg.branch || 'main'
      };
      var records = {};
      if (raw) records[DOC_KEY] = raw;
      if (oldMeta) records[OLD_META_KEY] = oldMeta;
      var cache = await cacheModule();
      await cache.savePending(location, records);
      clearPlaintext();
    } catch (error) {
      throw new Error('Offline edits could not be encrypted. The original cache is preserved; unlock is blocked.');
    }
  }

  var wired = false;
  async function start(payload) {
    if (demo) return startDemo();
    if (lockPromise) await lockPromise;
    if (active) throw new Error('Lock the current task session before opening another.');
    var epoch = ++generation;
    await prepare();
    if (epoch !== generation) throw new Error('Task session ended');
    var location = {
      owner: payload.owner, repo: payload.repo, path: payload.path, branch: payload.branch
    };
    var records = null;
    cacheUnavailable = false;
    try {
      var cache = await cacheModule();
      records = await cache.loadPending(location);
    } catch (error) {
      if (error.code !== 'PENDING_UNAVAILABLE') throw error;
      cacheUnavailable = true;
    }
    if (epoch !== generation) throw new Error('Task session ended');
    cfg = {
      token: payload.token, repo: payload.owner + '/' + payload.repo,
      path: payload.path, branch: payload.branch, deviceId: cfg.deviceId
    };
    doc = emptyDoc();
    meta = freshMeta();
    ui = freshUi();
    try {
      restore(records);
    } catch (error) {
      delete cfg.token;
      doc = emptyDoc();
      meta = freshMeta();
      throw new Error('Offline task edits could not be restored. The encrypted cache is preserved.');
    }
    controller = new AbortController();
    active = true;
    closing = false;
    netFails = 0;
    storageError = '';
    try {
      save(CFG_KEY, {
        repo: cfg.repo, path: cfg.path, branch: cfg.branch, deviceId: cfg.deviceId
      });
    } catch (ignored) {}
    persist();
    $('#app').inert = false;
    renderShell();
    render();
    sync();
    poll();
    if (!wired) {
      wired = true;
      document.addEventListener('visibilitychange', function () {
        if (active && !document.hidden) sync();
      });
      window.addEventListener('online', function () { sync(); });
      window.addEventListener('focus', function () { schedule(100); });
    }
  }

  function lock() {
    if (demo) { window.location.href = './'; return Promise.resolve(); }
    if (lockPromise) return lockPromise;
    if (!active) {
      generation += 1;
      return Promise.resolve();
    }
    lockPromise = finishLock().finally(function () { lockPromise = null; });
    return lockPromise;
  }
  async function finishLock() {
    finishEditor(true);
    closing = true;
    $('#app').inert = true;
    clearTimeout(pollTimer);
    clearTimeout(debounce);
    clearTimeout(relativeTimer);
    resetDrag();
    persist();
    var timer;
    try {
      await Promise.race([
        sync(true),
        new Promise(function (resolve) { timer = setTimeout(resolve, 1500); })
      ]);
      clearTimeout(timer);
      // Retire the entire network generation before snapshotting. An ignored
      // abort or delayed response cannot alter this snapshot or a later session.
      generation += 1;
      controller.abort();
      controller = new AbortController();
      syncing = false;
      syncPromise = null;
      again = false;
      updateDirty();
      var cache = await cacheModule();
      try {
        if (cacheUnavailable) {
          var recovered = await cache.loadPending(scope());
          if (recovered && recovered[DOC_KEY]) {
            var saved = JSON.parse(recovered[DOC_KEY]);
            doc = merge(validateDoc(saved.doc || saved), doc);
            updateDirty();
            persist();
          }
          cacheUnavailable = false;
        }
        await cache.savePending(scope(), snapshot());
      } catch (error) {
        // A genuinely ephemeral session may lock without a cache only when
        // GitHub has acknowledged every edit. Never discard dirty memory.
        if (!cacheUnavailable || meta.dirty || error.code !== 'PENDING_UNAVAILABLE') throw error;
      }
      clearPlaintext();
    } catch (error) {
      clearTimeout(timer);
      closing = false;
      persist();
      render();
      $('#app').inert = false;
      setStatus('err', 'Could not protect offline edits. Tasks remains unlocked; retry after storage is available.');
      poll();
      refreshSyncTime();
      throw new Error('Could not protect offline edits. Tasks remains unlocked.');
    }
    active = false;
    closing = false;
    controller.abort();
    controller = null;
    delete cfg.token;
    doc = emptyDoc();
    meta = freshMeta();
    ui = freshUi();
    focusId = null;
    storageError = '';
    clearTimeout(toast.timer);
    swallowClick = false;
    $('#app').innerHTML = '';
    $('#app').inert = false;
  }

  function startDemo() {
    if (!demo || active) return;
    var stored = load(DOC_KEY, null);
    doc = stored && stored.doc ? validateDoc(stored.doc) : validateDoc(window.TasksDemoFixtures());
    meta = freshMeta();
    meta.base = clone(doc);
    ui = freshUi();
    var savedUi = load(UI_KEY, {});
    ui.query = savedUi.query || '';
    ui.roomFilter = savedUi.roomFilter || '';
    ui.tab = /^(tasks|ideas|done)$/.test(savedUi.tab) ? savedUi.tab : 'tasks';
    ui.datesCollapsed = savedUi.datesCollapsed !== false;
    ui.ownerFilter = savedUi.ownerFilter || 'all';
    ui.collapsedTriggers = savedUi.collapsedTriggers || {};
    active = true;
    cfg.repo = 'demo/fictional'; cfg.path = 'tasks.json'; cfg.branch = 'local';
    try { save(CFG_KEY, { deviceId: cfg.deviceId }); } catch (ignore) {}
    document.body.className = document.body.className.replace(/\s*auth-blocked/g, '');
    $('#lock-screen').hidden = true;
    $('#setup-screen').hidden = true;
    $('#app').inert = false;
    renderShell(); render(); persist(); sync();
  }
  function resetDemo() {
    var previous = clone(doc);
    finishEditor(false);
    doc = validateDoc(window.TasksDemoFixtures());
    ui = freshUi(); focusId = null;
    persist(); renderShell(); render(); sync();
    toast('Demo reset', function () {
      doc = previous; persist(); render();
    });
  }
  window.TasksApp = { prepare: prepare, start: start, lock: lock, demo: demo, startDemo: startDemo };
  window.__tasks = {
    sync: sync,
    state: function () {
      return clone({ doc: doc, meta: meta, ui: ui, active: active });
    }
  };
  window.__tasksDrag = {
    active: function () {
      return !!drag.active;
    }
  };
})();
