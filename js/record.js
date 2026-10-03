// Record Screen: one form, a camcorder REC clock, and the required-field check on STOP
// (prd.md > Recording a Tape, spec.md > Record Screen).

import { todayLocal, formatVcrDate, isDate } from './tapes.js';
import { canRecord, startRecording, voiceClock, VOICE_MAX_MS, levelMeter, drawMeter } from './voice.js';

const REQUIRED = ['project', 'returnDate', 'firstStep'];
const TEXT_FIELDS = ['project', 'stopped', 'firstStep', 'unsure', 'why'];

export function initRecord(section, { onSave, onBack }) {
  const form = section.querySelector('[data-record-form]');
  const clock = section.querySelector('[data-rec-clock]');
  const stamp = section.querySelector('[data-rec-stamp]');
  const error = section.querySelector('[data-record-error]');
  const dateEcho = section.querySelector('[data-date-echo]');
  let clockTimer = null;

  // ── Voice note: record, listen back, delete (kept until the tape is saved or the page closes) ──
  const voiceBox = section.querySelector('[data-voice]');
  const recBtn = section.querySelector('[data-voice-rec]');
  const recText = section.querySelector('[data-voice-rec-text]');
  const listenBtn = section.querySelector('[data-voice-listen]');
  const deleteBtn = section.querySelector('[data-voice-delete]');
  const voiceClockEl = section.querySelector('[data-voice-clock]');
  const voiceNote = section.querySelector('[data-voice-note]');
  const listenText = section.querySelector('[data-voice-listen-text]');
  const meter = section.querySelector('[data-voice-meter]');
  const bar = section.querySelector('[data-voice-bar]');
  const barFill = section.querySelector('[data-voice-bar-fill]');
  let stopListenMeter = () => {};
  // While recording or listening, the meter and the bar show that sound is actually going in or out.
  function activity(on) {
    meter.hidden = !on;
    bar.hidden = !on;
    if (!on) { drawMeter(meter, 0); barFill.style.width = '0%'; }
  }
  let voice = null;      // { blob, ms } once recorded
  let recording = null;  // the recording in progress
  let listening = null;  // an Audio element while listening back
  if (!canRecord()) {
    recBtn.disabled = true;
    voiceNote.textContent = 'THIS BROWSER CAN\'T RECORD SOUND HERE. THE TAPE WORKS WITHOUT IT.';
    voiceNote.hidden = false;
  }
  function showVoice() {
    const has = Boolean(voice);
    listenBtn.hidden = !has || Boolean(recording);
    deleteBtn.hidden = !has || Boolean(recording);
    recText.textContent = recording ? 'STOP VOICE' : has ? 'RECORD AGAIN' : 'RECORD VOICE'; // not just STOP: the tape has its own ■ STOP
    listenText.textContent = listening ? 'PAUSE' : 'LISTEN';
    listenBtn.classList.toggle('is-playing', Boolean(listening));
    recBtn.classList.toggle('is-recording', Boolean(recording));
    recBtn.setAttribute('aria-pressed', String(Boolean(recording)));
    if (!recording) voiceClockEl.textContent = has ? voiceClock(voice.ms) : '';
  }
  function stopListening() {
    listening?.pause();
    listening = null;
    stopListenMeter();
    stopListenMeter = () => {};
    if (!recording) activity(false);
    showVoice();
  }
  recBtn.addEventListener('click', () => {
    if (recording) { recording.stop(); return; }
    stopListening();
    voiceNote.hidden = true;
    activity(true);
    recording = startRecording({
      onTick: (ms) => {
        voiceClockEl.textContent = `${voiceClock(ms)} / ${voiceClock(VOICE_MAX_MS)}`;
        barFill.style.width = `${Math.min(100, (ms / VOICE_MAX_MS) * 100)}%`;
      },
      onLevel: (level) => drawMeter(meter, level),
    });
    showVoice();
    recording.done.then((result) => {
      voice = result.ms >= 500 ? result : voice; // a slip of the finger isn't a note
    }, () => {
      voiceNote.textContent = 'NO MICROPHONE (OR ACCESS WAS REFUSED). THE TAPE WORKS WITHOUT IT.';
      voiceNote.hidden = false;
    }).finally(() => { recording = null; activity(false); showVoice(); });
  });
  // LISTEN plays the note back with the meter and a bar; pressing it again (PAUSE) stops it.
  listenBtn.addEventListener('click', async () => {
    if (!voice) return;
    if (listening) { stopListening(); return; }
    const url = URL.createObjectURL(voice.blob);
    const audio = new Audio(url);
    listening = audio;
    activity(true);
    showVoice();
    const total = voice.ms;
    audio.addEventListener('timeupdate', () => {
      const t = audio.currentTime * 1000;
      barFill.style.width = `${Math.min(100, (t / total) * 100)}%`;
      voiceClockEl.textContent = `${voiceClock(t)} / ${voiceClock(total)}`;
    });
    audio.addEventListener('ended', () => { URL.revokeObjectURL(url); if (listening === audio) { stopListening(); voiceClockEl.textContent = voiceClock(total); } }, { once: true });
    stopListenMeter = await levelMeter(audio, (level) => drawMeter(meter, level));
    if (listening !== audio) { stopListenMeter(); return; }
    audio.play().catch(() => stopListening());
  });
  deleteBtn.addEventListener('click', () => { stopListening(); voice = null; showVoice(); });
  function clearVoice() {
    recording?.stop();
    stopListening();
    voice = null;
    showVoice();
  }

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
    (form.elements.project.value ? form.elements.returnDate : form.elements.project).focus({ preventScroll: true }); // the screen is already in view; in the room, scrolling would shift the 3D layer
  }

  function leave() {
    clearInterval(clockTimer);
    clockTimer = null;
    recording?.stop(); // leaving the screen ends a recording (what was said so far is kept)
    stopListening();
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

    if (recording) { recording.stop(); return; } // finish the recording first; STOP again saves
    const tape = makeTape(values);
    if (voice) tape.voiceMs = voice.ms;
    onSave(tape, voice?.blob ?? null);
    form.reset();
    echoDate();
    markMissing([]);
    clearVoice();
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

  // PAUSE AGAIN starts a new tape for the same project, so its name is filled in already.
  function prefill(values) {
    form.reset();
    clearVoice();
    echoDate();
    for (const [name, value] of Object.entries(values)) if (form.elements[name]) form.elements[name].value = value;
  }

  return { enter, leave, prefill };
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
