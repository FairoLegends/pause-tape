// Tape rules: dates, tape state, shelf order. Pure helpers with no screen code,
// so they can be checked on their own (spec.md > Tape Rules).

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

// Today's date as YYYY-MM-DD in the device's local time. Never toISOString(): that's UTC,
// which is still "yesterday" in WIB before 07:00 and would lock a tape due today.
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isDate(value) {
  return DATE_RE.test(value);
}

// Whole calendar days between two YYYY-MM-DD dates. Counting in UTC days avoids
// daylight-saving hours getting in the way.
function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysUntil(date, today = todayLocal()) {
  return dayNumber(date) - dayNumber(today);
}

export function tapeState(tape, today = todayLocal()) {
  if (tape.backOnItMinutes != null) return 'completed';
  return tape.returnDate <= today ? 'ready' : 'locked';
}

const RANK = { ready: 0, locked: 1, completed: 2 };

// READY first, then locked with the nearest date first, then completed.
// Ties go to the newest recorded first.
export function sortTapes(list, today = todayLocal()) {
  return [...list].sort((a, b) =>
    RANK[tapeState(a, today)] - RANK[tapeState(b, today)]
    || a.returnDate.localeCompare(b.returnDate)
    || b.recordedAt.localeCompare(a.recordedAt));
}

export function formatVcrDate(date) {
  const [y, m, d] = date.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatDays(n) {
  return `${n} ${n === 1 ? 'DAY' : 'DAYS'}`;
}
