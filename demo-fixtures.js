/* Fictional schema 2 board; loaded locally, never from a data repository. */
(function () {
  'use strict';
  window.TasksDemoFixtures = function () {
    var ts = Date.now(), day = 86400000;
    function dateAfter(days) {
      var d = new Date(ts + days * day);
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    var rows = [
      ['today', 'Acme Labs', 'Sketch the moon garden', 'you', 'Use the fictional blue fern palette.'],
      ['today', 'Northwind', 'Send Dana the paper kite plan', 'chase:Dana', 'Ask for the small prototype first.'],
      ['today', 'Juniper Co', 'Review the cloud lantern sample', 'waiting:Priya', 'Priya is testing the imaginary glow setting.'],
      ['today', 'Studio', 'Pack the cardboard telescope', 'you', 'Include spare paper lenses.'],
      ['followups', 'Acme Labs', 'Check the marshmallow bridge draft', 'chase:Sam', ''],
      ['followups', 'Northwind', 'Collect the tiny orchard sketches', 'waiting:Dana', 'Two variations would help.'],
      ['followups', 'Juniper Co', 'Share the pretend launch checklist', 'you', ''],
      ['followups', 'Studio', 'Ask Priya about the ribbon samples', 'chase:Priya', ''],
      ['triggers', 'Acme Labs', 'Assemble the comet model', 'you', 'After the sample arrives.', 'Sample arrives'],
      ['triggers', 'Northwind', 'Book the imaginary observatory', 'waiting:Sam', '', 'Sample arrives'],
      ['triggers', 'Juniper Co', 'Print the storybook invitations', 'you', 'Use recycled paper.', 'Design approved'],
      ['longterm', 'Studio', 'Build a pocket-sized paper city', 'you', 'Start with the train station.'],
      ['longterm', 'Acme Labs', 'Try a new origami solar system', 'you', ''],
      ['longterm', 'Northwind', 'Review the pretend winter display', 'waiting:Dana', ''],
      ['ideas', 'Studio', 'Imagine a library for toy robots', 'you', 'Books could be the size of postage stamps.'],
      ['ideas', 'Juniper Co', 'Design a floating teacup poster', 'you', ''],
      ['today', 'Acme Labs', 'File the fictional rehearsal notes', 'you', 'Notes are ready for the next rehearsal.'],
      ['followups', 'Northwind', 'Send the practice thank-you card', 'you', ''],
      ['longterm', 'Juniper Co', 'Revisit the paper meadow layout', 'you', 'Hidden until next week.'],
      ['ideas', 'Studio', 'Reconsider the miniature balloon parade', 'you', 'Hidden until next month.']
    ];
    var tasks = rows.map(function (row, i) {
      var t = {
        id: 5000 + i, label: String(5000 + i), section: row[0], room: row[1],
        text: row[2], title: row[2], titleAuto: true, detail: row[2],
        owner: row[3], note: row[4], tags: [], done: false, hidden: false,
        deleted: false, source: 'app', createdAt: ts - 3 * day,
        updatedAt: ts - day, deviceId: 'demo-fixture'
      };
      if (row[5]) t.trigger = row[5];
      if (i === 16 || i === 17) { t.done = true; t.doneAt = ts; }
      if (i >= 18) {
        t.hidden = true;
        t.hideUntilDate = dateAfter(i === 18 ? 7 : 30);
        t.hideUntil = t.hideUntilDate;
      }
      return t;
    });
    return {
      schema: 2,
      sections: [
        { id: 'today', name: 'Today' }, { id: 'followups', name: 'Follow-ups' },
        { id: 'triggers', name: 'Triggers' }, { id: 'longterm', name: 'Long-term' },
        { id: 'ideas', name: 'Ideas' }
      ],
      tasks: tasks, updatedAt: ts - day
    };
  };
})();
