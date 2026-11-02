'use strict';
// Small, plain functions for the Jeep expense log. These run in the app and in Node tests.

const JEEP_COST_CATEGORIES = ['Insurance', 'Parts', 'Repairs', 'Maintenance', 'Registration', 'Towing', 'Other'];
const EXPENSE_NOTE_PREFIX = '[[heep-expense:v1:';

function category(row) {
  const sid = String(row && row.sid || '');
  return sid.indexOf('expense:') === 0 ? (sid.slice(8) || 'Other') : '';
}
function isExpense(row) { return !!category(row); }
function expensesFrom(log, selected) {
  return (Array.isArray(log) ? log : []).filter(row => isExpense(row) && (!selected || category(row) === selected));
}
function serviceHistoryFrom(log) { return (Array.isArray(log) ? log : []).filter(row => !isExpense(row)); }
// Apply the same add, edit and delete rules the app uses for its offline log queue.
function applyLogOperation(log, op) {
  if (!Array.isArray(log) || !op || op.tab !== 'log') return log;
  const id = op.op === 'del' ? op.id : op.row && op.row.id;
  if (!id) return log;
  const i = log.findIndex(row => row && row.id === id);
  if (op.op === 'put' && op.row) {
    if (i >= 0) log[i] = Object.assign({}, log[i], op.row);
    else log.push(Object.assign({}, op.row));
  } else if (op.op === 'del' && i >= 0) log.splice(i, 1);
  return log;
}
function reminderDoneRow(reminder, date, installedKm) {
  if (!reminder || !reminder.id || !(typeof date === 'number' && Number.isFinite(date) && date > 0)) return null;
  const km = typeof installedKm === 'number' && Number.isFinite(installedKm) && installedKm > 0
    ? Math.round(installedKm) : reminder.lastKm == null ? '' : reminder.lastKm;
  return { id: reminder.id, lastKm: km, lastT: date };
}
function parseAmount(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text || !/^-?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})$/.test(text)) return null;
  const amount = Number(text.replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}
function validateExpense(input) {
  const name = String(input && input.name || '').trim();
  const amount = typeof (input && input.amount) === 'number' ? input.amount : parseAmount(input && input.amount);
  const date = input && input.date;
  if (!name) return { ok: false, field: 'name', message: 'Name the expense, like Insurance or Brake pads.' };
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, field: 'amount', message: 'Type an amount greater than zero, like 12.50.' };
  }
  const dateText = String(date || '');
  const dateOk = typeof date === 'number'
    ? Number.isFinite(date) && date > 0
    : /^\d{4}-\d{2}-\d{2}$/.test(dateText) && Number.isFinite(Date.parse(dateText)) && new Date(dateText + 'T00:00:00.000Z').toISOString().slice(0, 10) === dateText;
  if (!dateOk) {
    return { ok: false, field: 'date', message: 'Choose the date.' };
  }
  return { ok: true, name, amount: Math.round(amount * 100) / 100 };
}
function amountTotal(rows) {
  let total = 0, found = false;
  for (const row of rows || []) {
    const amount = row && row.cost !== '' && row.cost != null ? Number(row.cost) : NaN;
    if (Number.isFinite(amount)) { total += amount; found = true; }
  }
  return found ? total : null;
}
function totalsByCategory(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const name = category(row);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, { category: name, count: 0, total: null });
    const group = groups.get(name);
    group.count++;
    const amount = row.cost !== '' && row.cost != null ? Number(row.cost) : NaN;
    if (Number.isFinite(amount)) group.total = (group.total == null ? 0 : group.total) + amount;
  }
  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category));
}
function packNote(details) {
  details = details || {};
  const data = {};
  for (const key of ['brand', 'part', 'reminderId', 'reminderName']) {
    const value = String(details[key] || '').trim();
    if (value) data[key] = value;
  }
  const note = String(details.note || '').trim();
  if (!Object.keys(data).length) return note;
  return EXPENSE_NOTE_PREFIX + encodeURIComponent(JSON.stringify(data)) + ']]' + (note ? '\n' + note : '');
}
function unpackNote(value) {
  const text = String(value || '');
  const out = { brand: '', part: '', reminderId: '', reminderName: '', note: text };
  if (!text.startsWith(EXPENSE_NOTE_PREFIX)) return out;
  const end = text.indexOf(']]', EXPENSE_NOTE_PREFIX.length);
  if (end < 0) return out;
  try {
    const data = JSON.parse(decodeURIComponent(text.slice(EXPENSE_NOTE_PREFIX.length, end)));
    for (const key of ['brand', 'part', 'reminderId', 'reminderName']) out[key] = String(data[key] || '');
    out.note = text.slice(end + 2).replace(/^\r?\n/, '');
  } catch (e) { /* A damaged note stays visible so it can be repaired. */ }
  return out;
}
function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function toCsv(rows) { return (rows || []).map(row => row.map(csvCell).join(',')).join('\r\n'); }

const JeepExpenses = { CATEGORIES: JEEP_COST_CATEGORIES, category, isExpense, expensesFrom, serviceHistoryFrom,
  applyLogOperation, reminderDoneRow, parseAmount, validateExpense, amountTotal, totalsByCategory, packNote, unpackNote, toCsv };
if (typeof module !== 'undefined') module.exports = JeepExpenses;
