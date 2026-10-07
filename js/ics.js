// Calendar file: builds the .ics text for a tape and hands it to the browser as a download
// (spec.md > Tape Saved Screen and Calendar File, spec.md > The .ics file). RFC 5545:
// CRLF line endings, lines folded at 75 octets, text escaped, an all-day event, and an
// alarm 8 hours after the start of the day, which is 08:00 on the device's own clock.

const CRLF = '\r\n';
const pad = (n) => String(n).padStart(2, '0');

// Commas, semicolons, backslashes, and line breaks have meaning in .ics text.
export function escapeText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Lines longer than 75 octets continue on the next line, which starts with one space.
// Split on whole characters, so a UTF-8 character (▶, —, é) is never cut in half.
export function foldLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const bytes = encoder.encode(ch).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // continuation lines lose one octet to the leading space
    }
    current += ch;
    size += bytes;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

// 2027-01-10 → 20270110, and the day after for the all-day end.
function icsDate(date) {
  return date.replace(/-/g, '');
}

function nextDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

function utcStamp(now) {
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T`
    + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

// link: the tape link (js/tapelink.js). Without one the file is exactly as before.
export function buildIcs(tape, now = new Date(), link = '') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pause Tape//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${tape.id}@pause-tape`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART;VALUE=DATE:${icsDate(tape.returnDate)}`,
    `DTEND;VALUE=DATE:${nextDay(tape.returnDate)}`,
    `SUMMARY:${escapeText(`▶ ${tape.project} — tape ready`)}`,
    // The notes end with the tape link, which puts the whole tape back on any browser's shelf; the URL
    // line is the same link for calendar apps that show one (prd.md > Calendar Reminder (.ics)).
    `DESCRIPTION:${escapeText(link ? `First step: ${tape.firstStep}\n\nPlay the tape: ${link}` : `First step: ${tape.firstStep}`)}`,
    ...(link ? [`URL:${link}`] : []),
    'TRANSP:TRANSPARENT',
    // The new Outlook for Windows showed a date-only event as 07:00 to 07:00 the next day (shifted by
    // the UTC offset) until these two Microsoft lines said "all day" and "free" (learner's test, 2 Oct 2026).
    'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
    'X-MICROSOFT-CDO-BUSYSTATUS:FREE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(tape.firstStep)}`,
    'TRIGGER;RELATED=START:PT8H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// pause-tape-no-signal-2027-01-10.ics: lowercase, safe characters only.
export function icsFileName(tape) {
  const slug = tape.project.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tape';
  return `pause-tape-${slug}-${tape.returnDate}.ics`;
}

// A Blob is a file made in memory; a temporary link hands it to the browser to save.
export function downloadIcs(tape, tapeUrl = '') {
  const blob = new Blob([buildIcs(tape, new Date(), tapeUrl)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = icsFileName(tape);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return link.download;
}
