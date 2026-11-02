'use strict';
const E = require('../../expenses.js');
const fs = require('fs'), path = require('path');
let checks = 0, failed = 0;
const ok = (condition, message) => { checks++; if (!condition) { failed++; console.log('FAIL', message); } };

const log = [
  { id: 's1', sid: 'oil', name: 'Oil change', cost: 80 },
  { id: 'e1', sid: 'expense:Parts', name: 'Brake pads', cost: 120.5 },
  { id: 'e2', sid: 'expense:Insurance', name: 'Insurance', cost: 900 },
  { id: 'e3', sid: 'expense:', name: 'Uncategorized expense', cost: 0 },
];
ok(E.expensesFrom(log).length === 3, 'only expense rows are selected from the shared log tab');
ok(E.expensesFrom(log, 'Parts')[0].id === 'e1', 'category filter keeps the selected category');
ok(E.serviceHistoryFrom(log).length === 1 && E.serviceHistoryFrom(log)[0].id === 's1', 'expense rows stay out of service history');
ok(E.totalsByCategory(E.expensesFrom(log)).find(x => x.category === 'Parts').total === 120.5, 'category total uses expense costs');
ok(E.amountTotal(E.expensesFrom(log)) === 1020.5, 'expense totals do not include a service-history row');
ok(E.category(log[3]) === 'Other', 'a legacy expense with a blank category stays in the expense log');

const localLog = [{ id: 's1', sid: 'oil', note: 'old' }];
E.applyLogOperation(localLog, { op: 'put', tab: 'log', row: { id: 'e3', sid: 'expense:Parts', cost: 12 } });
E.applyLogOperation(localLog, { op: 'put', tab: 'log', row: { id: 'e3', cost: 14 } });
ok(localLog.length === 2 && localLog[1].cost === 14, 'offline put adds an expense and edit updates the same row');
E.applyLogOperation(localLog, { op: 'del', tab: 'log', id: 'e3' });
ok(localLog.length === 1 && localLog[0].id === 's1', 'offline delete removes only the selected expense');
ok(E.reminderDoneRow(null, 1793577600000, 123) === null, 'a maintenance expense does not complete a reminder without a selection');
const done = E.reminderDoneRow({ id: 'serv-1', lastKm: 100 }, 1793577600000, null);
ok(done.lastT === 1793577600000 && done.lastKm === 100, 'a selected reminder gets the chosen date and keeps distance if km is unknown');

for (const value of ['', '0', '-2.00', '12,50', '1,20,000']) {
  ok(E.validateExpense({ name: 'Part', amount: value, date: 1793577600000 }).ok === false, 'rejects invalid amount ' + JSON.stringify(value));
}
ok(E.parseAmount('1,200') === 1200, 'accepts a correctly grouped thousands amount');
ok(E.validateExpense({ name: 'Oil filter', amount: '12.50', date: 1793577600000 }).amount === 12.5, 'accepts cents');
ok(E.validateExpense({ name: 'Oil filter', amount: '12.50', date: '' }).field === 'date', 'requires a date');
ok(E.validateExpense({ name: 'Oil filter', amount: '12.50', date: '2026-02-31' }).field === 'date', 'rejects a date that is not on the calendar');
ok(E.validateExpense({ name: '  ', amount: '12.50', date: 1793577600000 }).field === 'name', 'requires an item name');

const packed = E.packNote({ brand: 'Bosch & Co', part: 'P-123, 4', reminderId: 'serv-1', reminderName: 'Fuel filter', note: 'Changed at home\nkept old bolts' });
const details = E.unpackNote(packed);
ok(details.brand === 'Bosch & Co' && details.part === 'P-123, 4', 'keeps brand and part number in the existing note field');
ok(details.reminderId === 'serv-1' && details.note === 'Changed at home\nkept old bolts', 'keeps the optional reminder choice and note');
ok(E.unpackNote('ordinary note').note === 'ordinary note', 'old expense and service notes still read normally');

// The Overview and Scriptable widget derive diesel cost/km from fill-ups and trips, not general expenses.
const root = path.resolve(__dirname, '../..');
const W = require('../../widget/heep-widget.js');
const L = W.loadLib(['core.js', 'econ.js', 'trips.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')));
const now = Date.UTC(2026, 9, 1);
const fuelLog = { fill: [
  { id: 'f1', t: now - 10 * 864e5, odo: 1000, lit: 100, cost: 150, full: true },
  { id: 'f2', t: now, odo: 2000, lit: 100, cost: 150, full: true },
], trip: [], serv: [], log: [], info: { odo: 2000, odoT: now, tank: 77.6 } };
const withExpenses = Object.assign({}, fuelLog, { log: [{ id: 'large', sid: 'expense:Repairs', cost: 25000 }] });
const fuelModel = W.model(fuelLog, L, now), expenseModel = W.model(withExpenses, L, now);
ok(L.normalize(withExpenses).log.length === 1, 'expense stays available in the shared log data');
ok(fuelModel.st.perKm === expenseModel.st.perKm && W.block('cost', fuelModel).value === W.block('cost', expenseModel).value,
  'expense rows do not change Overview or widget diesel cost per km');

const csv = E.toCsv([['Item', 'Part number', 'Note'], ['Brake pads', 'P-123, 4', 'Said "replace"\nsoon']]);
ok(csv.includes('"P-123, 4"') && csv.includes('"Said ""replace""\nsoon"'), 'CSV quotes commas, quotes and newlines');
console.log('test_expenses.js: ' + checks + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
