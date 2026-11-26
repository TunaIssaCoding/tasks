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
      ['event', 'Studio', 'Fold the paper stage', 'chase', 'Dana', 6, 'Venue booked'],
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
        t.addedBy = 'Calls bot'; t.source = 'cli'; t.sourceLabel = 'call notes';
        t.sourceQuote = '…let\'s get the moon garden sketched before Friday…';
        t.tags = ['call notes']; t.note = 'Use the fictional blue fern palette.';
        t.detail = 'Draw three paper paths around the imaginary blue fern beds.';
      }
      return t;
    });
    return { schema: 3, tasks: tasks, updatedAt: ts - day };
  };
})();
