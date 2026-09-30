// Record Screen: one form, a camcorder REC clock, and the required-field check on STOP
// (prd.md > Recording a Tape, spec.md > Record Screen).

import { todayLocal, formatVcrDate, isDate } from './tapes.js';

const REQUIRED = ['project', 'returnDate', 'firstStep'];
const TEXT_FIELDS = ['project', 'stopped', 'firstStep', 'unsure', 'why'];

export function initRecord(section, { onSave, onBack }) {
  const form = section.querySelector('[data-record-form]');
  const clock = section.querySelector('[data-rec-clock]');
  const stamp = section.querySelector('[data-rec-stamp]');
  const error = section.querySelector('[data-record-error]');
  const dateEcho = section.querySelector('[data-date-echo]');
  let clockTimer = null;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    stop();
  });

  // BACK keeps what you've typed until you save or close the page.
  section.querySelector('[data-action="back"]').addEventListener('click', onBack);

  // Enter in a one-line field would submit the form. Only ■ STOP saves.
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  });

  form.addEventListener('input', (event) => {
    event.target.closest('.field')?.classList.remove('field--missing');
    if (event.target.name === 'returnDate') echoDate();
  });

  // The date picker shows the computer's own format (01/10/2027 could read as either
  // 1 Oct or 10 Jan), so the chosen date is echoed in the VCR format too.
  function echoDate() {
    const value = form.elements.returnDate.value;
    dateEcho.textContent = isDate(value) ? formatVcrDate(value) : '';
  }

  function enter() {
    const today = todayLocal();
    form.elements.returnDate.min = today;
    markMissing([]);
    stamp.textContent = formatVcrDate(today);
    const startedAt = Date.now();
    tick(startedAt);
    clockTimer = setInterval(() => tick(startedAt), 1000);
    form.elements.project.focus();
  }

  function leave() {
    clearInterval(clockTimer);
    clockTimer = null;
  }

  // Counts up from when the screen opened, like a camcorder: REC 00:00:15.
  function tick(startedAt) {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    clock.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
  }

  function stop() {
    const values = readForm();
    const today = todayLocal();
    const missing = REQUIRED.filter((name) => {
      if (name === 'returnDate') return !isDate(values.returnDate) || values.returnDate < today;
      return values[name] === '';
    });
    markMissing(missing);
    if (missing.length > 0) return;

    onSave(makeTape(values));
    form.reset();
    echoDate();
    markMissing([]);
  }

  function readForm() {
    const values = { returnDate: form.elements.returnDate.value };
    for (const name of TEXT_FIELDS) values[name] = form.elements[name].value.trim();
    return values;
  }

  function markMissing(names) {
    for (const field of form.querySelectorAll('.field')) {
      field.classList.toggle('field--missing', names.includes(field.dataset.field));
    }
    error.hidden = names.length === 0;
  }

  return { enter, leave };
}

// The shape saved in localStorage (spec.md > Data Model).
function makeTape(values) {
  return {
    id: `t_${Date.now()}`,
    project: values.project,
    returnDate: values.returnDate,
    stopped: values.stopped,
    firstStep: values.firstStep,
    unsure: values.unsure,
    why: values.why,
    recordedAt: new Date().toISOString(),
    backOnItMinutes: null,
    completedAt: null,
  };
}
