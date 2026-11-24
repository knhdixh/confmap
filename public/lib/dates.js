// Shared by the browser and the Worker: Todoist-style quick-add parsing.
//   "Submit abstract fri p1 #NeurIPS"  ->  { content: 'Submit abstract', due: '2026-11-27', priority: 1, venue: 'NeurIPS' }

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function todayIn(tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch { return new Date().toISOString().slice(0, 10); }
}

const toISO = (d) => d.toISOString().slice(0, 10);
const fromISO = (s) => new Date(s + 'T00:00:00Z');
export const addDays = (iso, n) => { const d = fromISO(iso); d.setUTCDate(d.getUTCDate() + n); return toISO(d); };
export const daysBetween = (a, b) => Math.round((fromISO(b) - fromISO(a)) / 864e5);
export const weekday = (iso) => fromISO(iso).getUTCDay();

// Turns a date phrase into YYYY-MM-DD relative to today (YYYY-MM-DD). Returns null if not a date.
export function parseDate(phrase, today) {
  const p = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(today|tod)$/.test(p)) return today;
  if (/^(tomorrow|tmr|tom)$/.test(p)) return addDays(today, 1);
  if (p === 'next week') return addDays(today, ((8 - weekday(today)) % 7) || 7);
  if (p === 'next month') { const d = fromISO(today); return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))); }
  let m = p.match(/^in (\d{1,3}) (day|days|week|weeks|month|months)$/);
  if (m) {
    const n = +m[1];
    if (m[2].startsWith('day')) return addDays(today, n);
    if (m[2].startsWith('week')) return addDays(today, 7 * n);
    const d = fromISO(today); d.setUTCMonth(d.getUTCMonth() + n); return toISO(d);
  }
  m = p.match(/^(?:next )?(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/);
  if (m) { const diff = (DAYS.indexOf(m[1]) - weekday(today) + 7) % 7 || 7; return addDays(today, diff); }
  m = p.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return p;
  m = p.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})(?:,? (\d{4}))?$/) ||
      p.match(/^(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:,? (\d{4}))?$/);
  if (m) {
    const [mon, day] = /^\d/.test(m[1]) ? [m[2], +m[1]] : [m[1], +m[2]];
    const t = fromISO(today);
    let year = m[3] ? +m[3] : t.getUTCFullYear();
    let d = new Date(Date.UTC(year, MONTHS.indexOf(mon), day));
    if (d.getUTCMonth() !== MONTHS.indexOf(mon)) return null;
    if (!m[3] && toISO(d) < today) d = new Date(Date.UTC(year + 1, MONTHS.indexOf(mon), day));
    return toISO(d);
  }
  return null;
}

const DATE_PATTERNS = [
  /\b(?:in \d{1,3} (?:days?|weeks?|months?))\b/i,
  /\bnext (?:week|month)\b/i,
  /\b(?:next )?(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?\b/i,
  /\b(?:today|tod|tomorrow|tmr)\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:,? \d{4})?\b/i,
  /\b\d{1,2} (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?: \d{4})?\b/i,
];

export function parseQuickAdd(text, today) {
  let s = ' ' + String(text || '') + ' ';
  let priority = 4, venue = null, due = null;
  s = s.replace(/\s!?p([1-4])(?=\s)/i, (_, n) => { priority = +n; return ' '; });
  s = s.replace(/\s#(?:"([^"]+)"|(\S+))/, (_, q, w) => { venue = (q || w).replace(/_/g, ' '); return ' '; });
  for (const re of DATE_PATTERNS) {
    const m = s.match(re);
    if (m) { const d = parseDate(m[0], today); if (d) { due = d; s = s.replace(m[0], ' '); break; } }
  }
  return { content: s.replace(/\s+/g, ' ').trim(), due, priority, venue };
}

// Todoist-like label + colour class for a due date.
export function dueLabel(due, today) {
  if (!due) return null;
  const n = daysBetween(today, due);
  const d = fromISO(due);
  const short = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (n < 0) return { text: n === -1 ? 'Yesterday' : short, cls: 'overdue' };
  if (n === 0) return { text: 'Today', cls: 'today' };
  if (n === 1) return { text: 'Tomorrow', cls: 'tomorrow' };
  if (n < 7) return { text: d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' }), cls: 'week' };
  return { text: n > 300 ? short + ' ' + d.getUTCFullYear() : short, cls: 'later' };
}
