/* GitHub-backed Tasks PWA. Classic script; ES2017 syntax. No bundled task data. */
(function () {
  'use strict';

  var CFG_KEY = 'tasks.cfg', DOC_KEY = 'tasks.doc', OLD_META_KEY = 'tasks.meta', UI_KEY = 'tasks.ui';
  var netFails = 0;
  var FILE = 'tasks.json', NATIVE_MIN = 5000, POLL_MS = 15000;
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
  function ownerInfo(value) {
    var raw = String(value || 'you'), match, name;
    if (raw === 'you') return { kind: 'you', label: 'You', cls: 'you' };
    match = /^(chase|waiting):(.+)$/.exec(raw);
    if (match) {
      name = match[2].trim();
      if (match[1] === 'chase') {
        return { kind: 'chase', label: 'Chase ' + name, cls: 'chase' };
      }
      return { kind: 'waiting', label: 'Waiting on ' + name, cls: 'waiting' };
    }
    return { kind: 'you', label: 'You', cls: 'you' };
  }
  function triggerDate(t) {
    return parseDate(t.hideUntilDate || t.hideUntil || '');
  }
  function shortDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = new Date(0);
    d.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setUTCHours(0, 0, 0, 0);
    return days[d.getUTCDay()] + ' ' + Number(m[3]) + ' ' +
      months[Number(m[2]) - 1];
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
    if (!value || value.schema !== 2 ||
        !Array.isArray(value.sections) || !Array.isArray(value.tasks)) {
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
    return {
      schema: 2,
      sections: clone(value.sections),
      tasks: value.tasks.map(publicTask).sort(function (a, b) {
        return a.id - b.id;
      }),
      updatedAt: value.updatedAt || 0
    };
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
  if (!cfg.deviceId) cfg.deviceId = deviceId();
  if (!cfg.repo) cfg.repo = 'TunaIssaCoding/tasks-data';

  var stored = load(DOC_KEY, null);
  var doc = emptyDoc();
  var meta = { sha: null, dirty: false, lastSync: 0, base: emptyDoc() };

  if (stored && stored.doc && stored.repo === cfg.repo) {
    doc = stored.doc;
    meta = stored.meta || meta;
  } else if (stored && stored.schema === 2) {
    doc = stored;
    var oldMeta = load(OLD_META_KEY, {});
    meta.sha = oldMeta.sha || null;
    meta.lastSync = oldMeta.lastSync || 0;
  }
  if (!meta.base) meta.base = emptyDoc();

  var storedUi = load(UI_KEY, {});
  var ui = {
    query: String(storedUi.query || '').toLowerCase(),
    showHidden: !!storedUi.showHidden,
    ownerFilter: /^(all|you|chase|waiting)$/.test(storedUi.ownerFilter) ?
      storedUi.ownerFilter : 'all',
    collapsedTriggers: storedUi.collapsedTriggers &&
      typeof storedUi.collapsedTriggers === 'object' ?
      storedUi.collapsedTriggers : {},
    open: {}, status: 'idle', msg: '', setup: false
  };
  var syncing = false, again = false, pollTimer = 0, debounce = 0;
  var storageError = '';
  function persistUi() {
    try {
      save(UI_KEY, {
        query: ui.query,
        showHidden: ui.showHidden,
        ownerFilter: ui.ownerFilter,
        collapsedTriggers: ui.collapsedTriggers
      });
    } catch (e) {}
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
    updateDirty();
    try {
      /*
       * Document and acknowledgement baseline are one localStorage write.
       * A crash cannot leave a new edit paired with an old "clean" flag.
       */
      save(DOC_KEY, { repo: cfg.repo, doc: doc, meta: meta });
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

    var sections = clone(remote.sections);
    var sectionIds = Object.create(null);
    sections.forEach(function (s) { sectionIds[s.id] = true; });
    local.sections.forEach(function (s) {
      if (!sectionIds[s.id]) {
        sections.push(clone(s));
        sectionIds[s.id] = true;
      }
    });
    return {
      schema: 2,
      sections: sections,
      tasks: Object.keys(map).map(function (id) { return map[id]; })
        .sort(function (a, b) { return a.id - b.id; }),
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
    };
  }

  /* ---------- GitHub contents API ---------- */

  function apiError(method, status) {
    var e = new Error(method + ' ' + status);
    e.status = status;
    return e;
  }
  function gh(method, path, body) {
    return fetch('https://api.github.com/repos/' + cfg.repo + path, {
      method: method,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
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
  async function getRemote() {
    var res = await gh('GET', '/contents/' + FILE + '?ref=main');
    if (res.status === 404) {
      /* A missing file is not evidence that this private repo is accessible. */
      var repoResponse = await gh('GET', '');
      if (!repoResponse.ok) throw apiError('GET', repoResponse.status);
      return { doc: emptyDoc(), sha: null };
    }
    if (!res.ok) throw apiError('GET', res.status);
    var entry = await res.json();
    var content = entry.content;
    if (!content && entry.size > 0) {
      var blobResponse = await gh('GET', '/git/blobs/' + entry.sha);
      if (!blobResponse.ok) throw apiError('GET blob', blobResponse.status);
      var blob = await blobResponse.json();
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
  async function sync() {
    if (!cfg.token || ui.setup) return;
    if (syncing) {
      again = true;
      return;
    }
    syncing = true;
    setStatus('busy', 'Syncing…');
    try {
      var completed = false;
      for (var attempt = 0; attempt < 6; attempt++) {
        var remote = await getRemote();

        /*
         * Read the live document after GET resolves. Edits during GET are
         * included; merge never mutates either input.
         */
        doc = merge(doc, remote.doc);
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
          branch: 'main',
          content: b64encode(JSON.stringify(published, null, 1))
        };
        if (remote.sha) body.sha = remote.sha;
        var response = await gh('PUT', '/contents/' + FILE, body);

        if (response.ok) {
          var result = await response.json();
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
          if (attempt < 5) await delay(400 * (attempt + 1));
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
        setStatus('ok', 'Synced ' +
          new Date(meta.lastSync).toLocaleTimeString());
      }
    } catch (err) {
      persist();
      if (storageError) {
        setStatus('err', storageError);
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
      syncing = false;
      if (again) {
        again = false;
        schedule(300);
      }
    }
  }
  function schedule(ms) {
    clearTimeout(debounce);
    debounce = setTimeout(sync, ms == null ? 300 : ms);
  }
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(function () {
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
  /* Signature of user-visible fields; a no-op edit (e.g. dismissed prompt) must not win LWW. */
  function taskSig(t) {
    var c = {}, k;
    for (k in t) if (k !== 'updatedAt' && k !== 'deviceId' && k.charAt(0) !== '_') c[k] = t[k];
    return JSON.stringify(c, Object.keys(c).sort());
  }
  function touch(t, before) {
    if (before != null && taskSig(t) === before) return;
    t.updatedAt = Math.max(now(), (t.updatedAt || 0) + 1);
    t.deviceId = cfg.deviceId;
    doc.updatedAt = Math.max(doc.updatedAt || 0, t.updatedAt);
    persist();
    render();
    if (syncing) again = true;
    schedule();
  }
  function addTask(raw, section) {
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
      section: section,
      room: room,
      text: text,
      title: shortTitle(text || raw),
      titleAuto: true,
      detail: raw,
      owner: 'you',
      note: '',
      tags: [],
      done: false,
      hidden: false,
      deleted: false,
      source: 'app',
      createdAt: ts,
      updatedAt: ts,
      deviceId: cfg.deviceId,
      _new: true,
      _creator: cfg.deviceId
    };
    doc.tasks.push(task);
    touch(task);
  }
  function isHidden(t) {
    return !!t.hidden &&
      (!t.hideUntilDate || t.hideUntilDate > todayIso());
  }
  function triggerLabel(t) {
    return String(t.trigger || '').trim();
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
    var sec = el && el.closest ? el.closest('.sec[data-sec]') : null;
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
    drag.allowRender = true;
    render();
    drag.allowRender = false;
    drag.li = $('#list li.task[data-id="' + esc(drag.id) + '"]');
    if (!drag.li) {
      resetDrag();
      return;
    }
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
    var before = drag.before;
    var isGroup = target && target.getAttribute('data-trigger') != null;
    var section = isGroup ? 'triggers' :
      target && target.getAttribute('data-sec');
    var trigger = isGroup ? target.getAttribute('data-trigger') : null;
    resetDrag();
    if (!wasActive) return;
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 350);
    if (cancel || !target) return;
    var t = byId(id);
    if (!t || t.deleted || !section) return;
    if (isGroup) {
      if (t.section === 'triggers' && triggerLabel(t) === trigger) return;
      t.section = 'triggers';
      t.sectionManual = true;
      if (trigger) t.trigger = trigger;
      else delete t.trigger;
      t.triggerManual = true;
      touch(t, before);
      return;
    }
    if (section === t.section) return;
    t.section = section;
    t.sectionManual = true;
    touch(t, before);
  }
  function beginPress(li, x, y, kind, pointerId) {
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
  function mouseDown(e) {
    pointerDown(e);
  }
  function mouseMove(e) {
    if (!drag.press || drag.kind !== 'mouse') return;
    movePress(e.clientX, e.clientY, e);
  }
  function mouseUp() {
    if (!drag.press || drag.kind !== 'mouse') return;
    finishDrag(false);
  }
  function wireDrag() {
    var list = $('#list');
    if (!list) return;
    list.addEventListener('touchstart', touchStart, { passive: true });
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', function () { if (drag.press && drag.kind === 'touch') finishDrag(false); });
    document.addEventListener('touchcancel', function () { if (drag.press && drag.kind === 'touch') finishDrag(true); });
    if (window.PointerEvent) {
      list.addEventListener('pointerdown', pointerDown);
      document.addEventListener('pointermove', pointerMove);
      document.addEventListener('pointerup', pointerUp);
      document.addEventListener('pointercancel', function (e) {
        if (drag.press && drag.pointerId === e.pointerId) finishDrag(true);
      });
    } else {
      list.addEventListener('mousedown', mouseDown);
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
    document.addEventListener('contextmenu', function (e) {
      if (drag.press || drag.active ||
          (e.target.closest && e.target.closest('li.task'))) {
        e.preventDefault();
      }
    });
  }

  /* ---------- rendering ---------- */

  function setStatus(kind, message) {
    ui.status = kind;
    ui.msg = message;
    var el = $('#sync');
    if (el) {
      el.className = 'sync ' + kind;
      el.textContent = message;
    }
  }
  function toast(message) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show';
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.className = 'toast'; }, 3000);
  }
  function renderSetup(error) {
    ui.setup = true;
    $('#app').innerHTML =
      '<div class="setup"><h1>Connect Tasks</h1>' +
      '<p>The token is stored in this browser and sent only to api.github.com. ' +
      'Use a token with Contents read/write access to the private data repo.</p>' +
      '<label for="tok">GitHub token</label>' +
      '<input class="input" id="tok" type="password" autocomplete="off" ' +
      'autocapitalize="off" spellcheck="false">' +
      '<label for="repo">Data repo (owner/name)</label>' +
      '<input class="input" id="repo" autocapitalize="off" spellcheck="false" ' +
      'value="' + esc(cfg.repo) + '">' +
      '<p class="err" id="setupErr">' + esc(error || '') + '</p>' +
      '<button class="btn primary" id="connect">Connect</button> ' +
      (cfg.token ?
        '<button class="btn" id="cancelSetup">Cancel</button> ' +
        '<button class="btn" id="forget">Forget token</button>' : '') +
      '</div>';

    $('#connect').onclick = async function () {
      var tok = $('#tok').value.trim() || cfg.token;
      var repo = $('#repo').value.trim();
      if (!tok) {
        $('#setupErr').textContent = 'Token required';
        return;
      }
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        $('#setupErr').textContent = 'Use owner/repo';
        return;
      }
      updateDirty();
      if (repo !== cfg.repo && meta.dirty) {
        $('#setupErr').textContent =
          'Sync queued edits before switching repositories';
        return;
      }

      var old = { token: cfg.token, repo: cfg.repo };
      var button = $('#connect');
      button.disabled = true;
      if ($('#cancelSetup')) $('#cancelSetup').disabled = true;
      if ($('#forget')) $('#forget').disabled = true;
      $('#setupErr').textContent = 'Checking…';
      cfg.token = tok;
      cfg.repo = repo;
      try {
        await getRemote();
        save(CFG_KEY, cfg);
        if (old.repo !== repo) {
          doc = emptyDoc();
          meta = { sha: null, dirty: false, lastSync: 0, base: emptyDoc() };
        }
        persist();
        start();
      } catch (e) {
        cfg.token = old.token;
        cfg.repo = old.repo;
        $('#setupErr').textContent = e.status ?
          'GitHub said ' + e.status +
          (e.status === 404 ? ' (repo not found or token lacks access)' : '') :
          'Connection or browser storage failed';
        button.disabled = false;
        if ($('#cancelSetup')) $('#cancelSetup').disabled = false;
        if ($('#forget')) $('#forget').disabled = false;
      }
    };
    if ($('#cancelSetup')) $('#cancelSetup').onclick = start;
    if ($('#forget')) {
      $('#forget').onclick = function () {
        updateDirty();
        if (meta.dirty &&
            !confirm('Forget this connection and discard queued edits?')) return;
        try {
          localStorage.removeItem(CFG_KEY);
          localStorage.removeItem(DOC_KEY);
          localStorage.removeItem(OLD_META_KEY);
          localStorage.removeItem(UI_KEY);
          location.reload();
        } catch (e) {
          $('#setupErr').textContent = 'Browser storage failed';
        }
      };
    }
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
    $('#app').innerHTML =
      '<header class="top"><div class="row1"><h1>Tasks</h1>' +
      '<span class="count" id="count"></span><span class="spacer"></span>' +
      '<span class="sync" id="sync"></span>' +
      '<button class="btn small" id="syncNow" title="Sync now">↻</button> ' +
      '<button class="btn small" id="settings" title="Settings">⚙</button>' +
      '</div><form class="add" id="add" autocomplete="off">' +
      '<input class="input" id="addText" placeholder="New task">' +
      '<select class="select" id="addSec"></select>' +
      '<button class="btn primary">Add</button></form>' +
      '<div class="tools"><input class="input" id="q" type="search" ' +
      'placeholder="Search"><label><input type="checkbox" id="showHidden">' +
      ' hidden</label></div><div class="chips" id="ownerFilters">' +
      '<button type="button" class="chip" data-owner="all">All</button>' +
      '<button type="button" class="chip" data-owner="you">You</button>' +
      '<button type="button" class="chip" data-owner="chase">Chase</button>' +
      '<button type="button" class="chip" data-owner="waiting">Waiting</button>' +
      '</div></header><main id="list"></main>' +
      '<div class="toast" id="toast"></div>';

    $('#q').value = ui.query;
    $('#showHidden').checked = ui.showHidden;
    $('#add').onsubmit = function (e) {
      e.preventDefault();
      addTask($('#addText').value, $('#addSec').value);
      $('#addText').value = '';
    };
    $('#q').oninput = function () {
      ui.query = this.value.toLowerCase();
      persistUi();
      render();
    };
    $('#showHidden').onchange = function () {
      ui.showHidden = this.checked;
      persistUi();
      render();
    };
    $('#ownerFilters').onclick = function (e) {
      var button = e.target.closest('button');
      if (!button) return;
      ui.ownerFilter = button.getAttribute('data-owner');
      persistUi();
      updateOwnerChips();
      render();
    };
    $('#syncNow').onclick = function () { sync(); };
    $('#settings').onclick = function () {
      if (syncing) {
        toast('Wait for the current sync before changing the connection');
        return;
      }
      renderSetup('');
    };
    $('#list').addEventListener('click', onListClick);
    $('#list').addEventListener('change', onListChange);
    wireDrag();
    updateOwnerChips();
    setStatus(ui.status === 'idle' ? 'busy' : ui.status, ui.msg || 'Loading…');
  }
  function moveOptions(current) {
    return doc.sections.map(function (s) {
      return '<option value="' + esc(s.id) + '"' +
        (s.id === current ? ' selected' : '') + '>' +
        esc(s.name) + '</option>';
    }).join('');
  }
  function taskHtml(t) {
    var hidden = isHidden(t);
    var cls = 'task' + (t.done ? ' done' : '') +
      (hidden ? ' hid' : '') + (ui.open[t.id] ? ' open' : '');
    var owner = ownerInfo(t.owner);
    var date = hidden ? triggerDate(t) : null;
    var title = hidden ? (date ? shortDate(date) : '') :
      shortTitle(t.title || t.text || '');
    var detail = hidden ? '' : String(t.detail || '');
    var note = hidden ? '' : String(t.note || '');
    var expanded = [detail, note].filter(function (value) {
      return value;
    }).join('\n');
    var trig = triggerLabel(t);
    return '<li class="' + cls + '" data-id="' + esc(t.id) + '">' +
      '<input type="checkbox"' + (t.done ? ' checked' : '') +
      ' aria-label="Done #' + esc(t.label || t.id) + '">' +
      '<div class="body"><span class="badge">#' +
      esc(t.label || t.id) + '</span>' +
      '<span class="owner ' + esc(owner.cls) + '">' +
      esc(owner.label) + '</span>' +
      '<span class="main">' +
      (trig && t.section !== 'triggers' ?
        '<span class="trig">' + esc(trig) + '</span>' : '') +
      '<span class="txt">' + esc(title) + '</span></span>' +
      (expanded ? '<div class="note">' + esc(expanded) + '</div>' : '') +
      '<div class="acts">' +
      '<button class="btn small" data-act="edit">Edit</button>' +
      '<button class="btn small" data-act="note">Note</button>' +
      '<button class="btn small" data-act="trigger">Trigger</button>' +
      '<button class="btn small" data-act="hide">' +
      (hidden ? 'Unhide' : 'Hide until…') + '</button>' +
      '<label class="move-label">Move to <select class="select small move-sel">' +
      moveOptions(t.section) + '</select></label>' +
      '<button class="btn small" data-act="del">Delete</button>' +
      '</div></div></li>';
  }
  function triggerGroupsHtml(open) {
    var dragging = (' ' + document.body.className + ' ').indexOf(' dragging ') !== -1;
    var labels = Object.create(null);
    var groups = Object.create(null);
    var i, label, keys, html = '';

    for (i = 0; i < open.length; i++) {
      label = triggerLabel(open[i]);
      labels[label] = true;
      if (!groups[label]) groups[label] = [];
      groups[label].push(open[i]);
    }
    if (dragging) {
      doc.tasks.forEach(function (t) {
        var existing;
        if (t.deleted) return;
        existing = triggerLabel(t);
        if (existing) labels[existing] = true;
      });
      labels[''] = true;
    }

    keys = Object.keys(labels).sort(function (a, b) {
      if (a === '') return 1;
      if (b === '') return -1;
      return a.toLowerCase() < b.toLowerCase() ? -1 :
        a.toLowerCase() > b.toLowerCase() ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    keys.forEach(function (key) {
      var tasks = groups[key] || [];
      var collapsed = !!ui.collapsedTriggers[key];
      if (!tasks.length && !dragging) return;
      html += '<div class="tgroup' + (collapsed ? ' collapsed' : '') +
        '" data-trigger="' + esc(key) + '">' +
        '<button type="button" class="tgroup-h">' +
        '<span class="caret">' + (collapsed ? '▸' : '▾') + '</span>' +
        '<span class="tlabel">' + esc(key || 'No trigger') + '</span>' +
        '<span class="tcount">' + tasks.length + '</span></button>' +
        '<ul>' + tasks.map(taskHtml).join('') +
        (!tasks.length && dragging ? '<li class="drop-here">Drop here</li>' : '') +
        '</ul></div>';
    });
    return html;
  }
  function render() {
    var list = $('#list');
    if (!list) return;
    /* Never rebuild the list mid-drag: it would detach the touched node and
       iOS/Chrome stop bubbling its touch events to document. */
    if (drag.active && !drag.allowRender) {
      drag.renderPending = true;
      return;
    }

    var select = $('#addSec'), previous = select.value;
    select.innerHTML = doc.sections.map(function (s) {
      return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>';
    }).join('');
    if (doc.sections.some(function (s) { return s.id === previous; })) {
      select.value = previous;
    }

    var q = ui.query, active = 0, hiddenN = 0;
    var anyVisible = false;
    var html = doc.sections.map(function (s) {
      var visible = doc.tasks.filter(function (t) {
        if (t.deleted || t.section !== s.id) return false;
        if (ui.ownerFilter !== 'all' &&
            ownerInfo(t.owner).kind !== ui.ownerFilter) return false;
        if (isHidden(t)) {
          hiddenN += 1;
          if (!ui.showHidden) return false;
        }
        if (!q) return true;
        return ('#' + (t.label || t.id) + ' ' + (t.title || '') +
          ' ' + (t.text || '') + ' ' + (t.detail || '') +
          ' ' + (t.note || '') + ' ' + triggerLabel(t) + ' ' +
          (t.tags || []).join(' ')).
          toLowerCase().indexOf(q) !== -1;
      });
      var open = visible.filter(function (t) { return !t.done; });
      var done = visible.filter(function (t) { return t.done; });
      active += open.length;
      if (open.length || done.length) anyVisible = true;
      done.sort(function (a, b) {
        return (b.doneAt || b.updatedAt || 0) -
          (a.doneAt || a.updatedAt || 0);
      });
      return '<section class="sec" data-sec="' + esc(s.id) + '"><h2>' +
        esc(s.name) + ' <span>' + open.length + '</span></h2>' +
        (s.id === 'triggers' ? triggerGroupsHtml(open) :
          '<ul>' + open.map(taskHtml).join('') +
          (open.length ? '' : '<li class="drop-here">Drop here</li>') + '</ul>') +
        (done.length ?
          '<details' + (q ? ' open' : '') + '><summary>Done (' +
          done.length + ')</summary><ul>' +
          done.map(taskHtml).join('') + '</ul></details>' : '') +
        '</section>';
    }).join('');
    list.innerHTML = html + (anyVisible ? '' : '<p class="empty">No tasks.</p>');
    $('#count').textContent = active + ' open' +
      (hiddenN ? ' · ' + hiddenN + ' hidden' : '');
  }
  function onListChange(e) {
    var li = e.target.closest('li.task');
    var t, before;
    if (!li) return;
    t = byId(li.getAttribute('data-id'));
    if (!t || t.deleted) return;
    if (e.target.type === 'checkbox') {
      t.done = e.target.checked;
      if (t.done) t.doneAt = now();
      else delete t.doneAt;
      touch(t);
    } else if (e.target.className &&
        (' ' + e.target.className + ' ').indexOf(' move-sel ') !== -1) {
      if (!doc.sections.some(function (s) { return s.id === e.target.value; })) return;
      before = taskSig(t);
      t.section = e.target.value;
      t.sectionManual = true;
      touch(t, before);
    }
  }
  function onListClick(e) {
    var h = e.target.closest && e.target.closest('.tgroup-h');
    if (h) {
      var group = h.closest('.tgroup');
      var label = group ? group.getAttribute('data-trigger') : '';
      ui.collapsedTriggers[label] = !ui.collapsedTriggers[label];
      if (!ui.collapsedTriggers[label]) delete ui.collapsedTriggers[label];
      persistUi();
      render();
      return;
    }

    var li = e.target.closest('li.task');
    if (!li || e.target.type === 'checkbox' ||
        (e.target.closest && e.target.closest('select'))) return;
    var t = byId(li.getAttribute('data-id'));
    if (!t || t.deleted) return;
    var button = e.target.closest('button');
    var action = button && button.getAttribute('data-act');
    var value;
    var before = taskSig(t);
    if (!action) {
      ui.open[t.id] = !ui.open[t.id];
      render();
      return;
    }
    if (action === 'edit') {
      value = prompt('Edit title', shortTitle(t.title || t.text || ''));
      if (value != null) {
        t.title = shortTitle(value);
        t.titleAuto = false;
        touch(t, before);
      }
    } else if (action === 'note') {
      value = prompt('Note', t.note || '');
      if (value != null) {
        t.note = value;
        touch(t, before);
      }
    } else if (action === 'trigger') {
      value = prompt('Trigger', triggerLabel(t));
      if (value != null) {
        value = value.trim();
        if (value) t.trigger = value;
        else delete t.trigger;
        t.triggerManual = true;
        touch(t, before);
      }
    } else if (action === 'hide') {
      if (isHidden(t)) {
        t.hidden = false;
        delete t.hideUntil;
        delete t.hideUntilDate;
        touch(t, before);
      } else {
        value = prompt('Hide until (YYYY-MM-DD or a trigger)', '');
        if (value != null && value.trim()) {
          value = value.trim();
          var date = parseDate(value);
          if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !date) {
            toast('Invalid calendar date');
            return;
          }
          t.hidden = true;
          t.hideUntil = value;
          if (date) t.hideUntilDate = date;
          else delete t.hideUntilDate;
          touch(t, before);
        }
      }
    } else if (action === 'del') {
      if (confirm('Delete #' + (t.label || t.id) + '?')) {
        t.deleted = true;
        touch(t, before);
        toast('Deleted #' + (t.label || t.id));
      }
    }
  }

  /* ---------- boot ---------- */

  var wired = false;
  function start() {
    if (!cfg.token) {
      renderSetup('');
      return;
    }
    ui.setup = false;
    renderShell();
    render();
    sync();
    poll();
    if (!wired) {
      wired = true;
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) sync();
      });
      window.addEventListener('online', function () { sync(); });
      window.addEventListener('focus', function () { schedule(100); });
    }
  }

  try {
    save(CFG_KEY, cfg);
  } catch (e) {
    storageError = 'Browser storage failed; connection cannot be saved';
  }
  persist();

  window.__tasks = {
    sync: sync,
    state: function () {
      return clone({ doc: doc, meta: meta, ui: ui });
    }
  };
  window.__tasksDrag = {
    active: function () {
      return !!drag.active;
    }
  };
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }
  start();
})();
