// Regression tests for the summary table (טבלה מסכמת): the user's rules, so a fixed mistake does not come back.
// Run: node tests/summary.test.js   (needs Playwright + Chromium; NODE_PATH=$(npm root -g) if Playwright is installed globally)
const { chromium } = require('playwright');
const path = require('path');
const app = 'file://' + path.join(__dirname, '..', 'app', 'index.html');

// a first invoice (everything current) and an invoice with previous amounts, an indexation adjustment the ERP subtracts
// after "סה"כ כולל התייקרות", retention / insurance percentages, a חו"ג offset and one row with no current amount
const header = { company: { name: 'חברה' }, doc: { seq: '7', month: '07/26', account_code: 'PC1', contract_code: 'CO1' }, contractor: { name: 'קבלן' } };
const items = [{ code: '01.01.0010', title: 'סעיף', unit: 'יח', cq: 1, cum: 1, pct: 100, cur: 1, price: 1, total: 1 }];
const R = (label, op, cur, prev, cum) => ({ label, op, cur, prev, cum });
const fixtures = {
  withPrevious: { info: { scope: 1000 }, vat_rate: 18,
    rows: [R('עבודות לפי חוזה', '+', 100, 900, 1000), R('מצטבר בחשבון זה', '=', 100, 900, 1000),
      R('התייקרות מצטברת', '+', 10, 40, 50), R('סה"כ כולל התייקרות', '=', 110, 940, 1050),
      R('פחות התאמת התייקרות מצטברת', '-', undefined, undefined, -20),
      R('פחות עכבון (5.00%)', '-', -5.5, -47, -52.5), R('פחות בגין ביטוח (1.80%)', '-', -1.98, -16.92, -18.9),
      R('סה"כ חשבון זה', '=', undefined, undefined, 958.6), { label: 'מצטבר בחשבון קודם', op: '-', prev: 860 },
      { label: 'סה"כ לתשלום', op: '=', cur: 98.6 }, { label: 'מע"מ', op: '+', cur: 17.75 }, { label: 'סה"כ כולל מע"מ', op: '=', cur: 116.35 }] }
};

(async () => {
const b = await chromium.launch(); const p = await b.newPage();
await p.route(/cdnjs\.cloudflare\.com/, r => r.abort());
await p.goto(app);
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if(!cond) failed++; };

for(const [name, summary] of Object.entries(fixtures)){
  console.log(name);
  await p.evaluate(d => window.__renderDemo(d), { header, items, fin: { groups: {}, summary } });
  const t = await p.evaluate(() => {
    const tbl = document.querySelector('#doc table.sumt');
    return { head: [...tbl.tHead.rows[0].cells].map(c => c.textContent.trim()),
      rows: [...tbl.tBodies[0].rows].map(tr => ({ cls: tr.className, cells: [...tr.cells].map(c => c.textContent.trim()) })) };
  });
  const lab = t.rows.map(r => r.cells[0]);
  const at = l => lab.findIndex(x => x.startsWith(l));
  const row = l => t.rows[at(l)];
  const tot = t.rows.find(r => r.cells[0] === 'סה"כ');

  ok(/סכום לחשבון חלקי/.test(t.head[1]) && /פעולה/.test(t.head[2]) && /מצטבר קודם/.test(t.head[3]) && /מצטבר נוכחי/.test(t.head[4]),
    'columns right to left: תיאור, סכום לחשבון חלקי, סימן, מצטבר קודם, מצטבר נוכחי');
  ok(at('פחות התאמת התייקרות') >= 0 && at('פחות התאמת התייקרות') < at('סה"כ כולל התייקרות'),
    'indexation adjustment sits ABOVE "סה"כ כולל התייקרות"');
  ok(row('סה"כ כולל התייקרות').cells[4] === '1,030.00', 'indexation subtotal shown includes the adjustment (1,050 − 20)');
  ok(t.rows.every(r => r.cls === 'sg' || /מע"מ/.test(r.cells[0]) || r.cells[1] !== ''), 'no row without a סכום לחשבון חלקי');
  ok(row('פחות התאמת התייקרות').cells[1] === '0.00' && row('פחות התאמת התייקרות').cells[3] === row('פחות התאמת התייקרות').cells[4],
    'unknown current amount → 0, previous = current cumulative');
  ok(at('עכבון') > at('קיזוזים וניכויים') && at('עכבון') < at('סיכום'), 'retention is its own block, after the deductions and before סיכום');
  ok(at('סה"כ כולל עכבון') > at('פחות עכבון') && at('סה"כ כולל עכבון') < at('סיכום'), 'retention block closes with "סה"כ כולל עכבון"');
  ok(at('סה"כ חשבון זה') < 0, '"סה"כ חשבון זה" is not shown');
  ok(tot && tot.cls === 'final' && tot.cells.slice(1).every(c => c !== ''), 'the "סה"כ" row has every column filled' + (tot ? ' [' + tot.cells.join(' | ') + ']' : ''));
  ok(at('סה"כ לתשלום') < 0, 'the total reads "סה"כ", not "סה"כ לתשלום"');
  ok(!lab.slice(at('סיכום')).some(l => /קודם/.test(l)), 'no "מצטבר … קודם" rows in סיכום (the "סה"כ" row shows the previous amount)');
  ok(at('מצטבר לאחר קיזוזים') < 0 || at('מצטבר לאחר קיזוזים') < at('עכבון'), 'the deductions subtotal reads "מצטבר לאחר קיזוזים"');
}
await b.close();
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
})();
