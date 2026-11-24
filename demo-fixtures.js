/* Fictional schema 3 board; loaded locally, never from a data repository. */
(function () {
  'use strict';
  window.TasksDemoFixtures = function () {
    var ts = Date.now(), day = 86400000;
    function dateAfter(days) {
      var d = new Date(ts); d.setDate(d.getDate() + days);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    var rows = [
      ['today', 'Acme Labs', 'Sketch the moon garden', 'me', '', 2],
      ['today', 'Northwind', 'Send the paper kite plan', 'chase', 'Dana', 2],
      ['today', 'Juniper Co', 'Review the cloud lantern sample', 'waiting', 'Priya', 6],
      ['today', 'Studio', 'Pack the cardboard telescope', 'me', '', 2],
      ['next', 'Acme Labs', 'Check the marshmallow bridge draft', 'chase', 'Sam', 12],
      ['next', 'Northwind', 'Collect tiny orchard sketches', 'waiting', 'Dana', 6],
      ['next', 'Juniper Co', 'Share the pretend launch checklist', 'me', '', 2],
      ['next', 'Studio', 'Ask about ribbon samples', 'chase', 'Priya', 6],
      ['event', 'Acme Labs', 'Assemble the comet model', 'me', '', 2, 'Sample arrives'],
      ['event', 'Northwind', 'Book the imaginary observatory', 'waiting', 'Sam', 12, 'Sample arrives'],
      ['event', 'Juniper Co', 'Print storybook invitations', 'me', '', 2, 'Design approved'],
      ['event', 'Studio', 'Fold the paper stage', 'chase', 'Dana', 6, 'Design approved'],
      ['later', 'Studio', 'Build a pocket paper city', 'me', '', 2],
      ['later', 'Acme Labs', 'Try an origami solar system', 'me', '', 2],
      ['later', 'Northwind', 'Review the pretend winter display', 'waiting', 'Dana', 12],
      ['date', 'Juniper Co', 'Revisit the paper meadow layout', 'me', '', 2, -2],
      ['date', 'Studio', 'Prepare the miniature balloon parade', 'me', '', 2, 7],
      ['date', 'Acme Labs', 'Frame the imaginary constellation', 'chase', 'Sam', 2, 3],
      ['date', 'Northwind', 'Arrange the toy lighthouse display', 'me', '', 2, 30],
      ['later', 'Studio', 'Imagine a library for toy robots', 'me', '', 2],
      ['later', 'Juniper Co', 'Design a floating teacup poster', 'me', '', 2],
      ['today', 'Acme Labs', 'File fictional rehearsal notes', 'me', '', 2],
      ['next', 'Northwind', 'Send the practice thank-you card', 'me', '', 2],
      ['today', 'Studio', 'Sort the paper stars', 'me', '', 2],
      ['later', 'Juniper Co', 'Finish the imaginary map', 'me', '', 2]
    ];
    var weekday = (new Date(ts).getDay() + 6) % 7;
    var tasks = rows.map(function (row, i) {
      var when = { kind: row[0] }, who = { kind: row[3] };
      if (row[4]) who.name = row[4];
      if (when.kind === 'event') when.event = row[6];
      if (when.kind === 'date') when.date = dateAfter(row[6]);
      var t = {
        id: 5000 + i, label: String(5000 + i), room: row[1],
        text: row[2], title: row[2], titleAuto: true, detail: row[2],
        who: who, when: when, kind: i === 19 || i === 20 ? 'idea' : 'task',
        whoSince: ts - row[5] * day, note: '', tags: [], done: false,
        deleted: false, source: 'app', createdAt: ts - 14 * day,
        updatedAt: ts - day, deviceId: 'demo-fixture'
      };
      if (i >= 21) {
        var completed = new Date(ts);
        completed.setDate(completed.getDate() - Math.min(i - 21, weekday));
        t.done = true; t.doneAt = completed.getTime();
      }
      if (i === 0) {
        t.acceptedFrom = 'p-demo-moon-garden'; t.source = 'Work Driver';
        t.tags = ['call notes']; t.note = 'Use the fictional blue fern palette.';
        t.detail = 'Draw three paper paths around the imaginary blue fern beds.';
      }
      return t;
    });
    return { schema: 3, tasks: tasks, updatedAt: ts - day };
  };
  window.TasksInboxFixtures = function () {
    var ts = Date.now(), day = 86400000, date = new Date(ts + 4 * day);
    var scheduled = date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) +
      '-' + ('0' + date.getDate()).slice(-2);
    function proposal(id, type, bot, label, quote, extra, age) {
      var p = { id: id, type: type, dedupeKey: 'demo:' + id,
        source: { bot: bot, label: label, quote: quote },
        createdAt: ts - (age || 1) * 3600000, decision: null };
      Object.keys(extra).forEach(function (key) { p[key] = extra[key]; });
      return p;
    }
    return { schema: 1, updatedAt: ts, proposals: [
      proposal('p-demo-call-checklist', 'add', 'Calls bot', 'call notes',
        'Sam will need the paper kite checklist before the next rehearsal.', {
          task: { text: 'Send Sam the paper kite checklist', who: { kind: 'me' },
            when: { kind: 'next' }, room: 'Northwind', tags: ['[call notes]'],
            note: 'Include the fictional ribbon measurements.', kind: 'task' }
        }, 1),
      proposal('p-demo-import-lantern', 'add', 'open.md importer', 'new line in open.md',
        'Ask Priya for the Juniper Co lantern colour samples.', {
          task: { text: 'Ask Priya for lantern colour samples', who: { kind: 'chase', name: 'Priya' },
            when: { kind: 'later' }, room: 'Juniper Co' }
        }, 2),
      proposal('p-demo-import-date', 'change', 'open.md importer', 'line #5006 changed',
        'Share the pretend launch checklist on the rehearsal date.', {
          taskId: 5006, changes: { when: { from: { kind: 'next' },
            to: { kind: 'date', date: scheduled } } }
        }, 3),
      proposal('p-demo-waiting-dana', 'change', 'Work Driver', 'waiting 6 days',
        'Dana has not sent the tiny orchard sketches yet.', {
          taskId: 5005, changes: {
            who: { from: { kind: 'waiting', name: 'Dana' }, to: { kind: 'chase', name: 'Dana' } },
            when: { from: { kind: 'next' }, to: { kind: 'today' } },
            text: { from: 'Collect tiny orchard sketches', to: 'Chase Dana about tiny orchard sketches' }
          }
        }, 4),
      proposal('p-demo-close-city', 'close', 'open.md importer', 'line #5012 was removed', '', {
        taskId: 5012
      }, 5),
      proposal('p-demo-moon-garden', 'add', 'Work Driver', 'call notes',
        'Sketch three paper paths around the imaginary blue fern beds.', {
          task: { text: 'Sketch the moon garden', who: { kind: 'me' },
            when: { kind: 'today' }, room: 'Acme Labs' },
          decision: { result: 'accepted', at: ts - day, taskId: 5000 }
        }, 48),
      proposal('p-demo-dismissed-poster', 'add', 'Calls bot', 'call notes',
        'Perhaps Studio could make another pretend poster.', {
          task: { text: 'Make another pretend poster', who: { kind: 'me' },
            when: { kind: 'later' }, room: 'Studio' },
          decision: { result: 'dismissed', at: ts - day }
        }, 30)
    ] };
  };
})();
