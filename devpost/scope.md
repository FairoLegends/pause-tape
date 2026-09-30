---
doc: scope
status: approved
---

# Pause Tape

A VHS-styled app for pausing a project cleanly: record a short "tape" to your future self when you stop, and play it back when you return so you know exactly what to do next.

## The Unique Kernel
Pausing a project becomes recording a message from your past self. When you come back, you "play the tape" on a CRT-style screen, and it hands you one small first step (about 10 minutes) with a timer, so you start working right away instead of staring and wandering. The app also records how many minutes it took you to actually get going again.

## Who It's For
Anyone with a side project they've been forced to put on hold. The first real user is the learner: they're freezing their horror game **NO SIGNAL** until 10 January 2027 for this hackathon, and they're afraid that when they come back they'll forget the progress, forget the decisions already made, and not know where to start. Today there's nothing in place for this. Context lives scattered across their head, a GDD, GitHub `issue.md` files, and their agents.

## The Core Loop
**Pause (record):** Pick or enter a project and fill in four things:
1. Where I stopped
2. The first step when I come back (small, about 10 minutes)
3. What I'm still unsure about
4. Why this project matters to me

Then choose a return date. The app generates a calendar file (`.ics`) so the reminder lands in the phone or laptop calendar. The note is saved as a "tape" labeled with the project name and date.

**Rewind (play back):** Open a shelf of project tapes. Tapes whose date hasn't arrived are locked and show a countdown on the label, but can still be played early after a confirmation ("so it still feels like a message from the past, but doesn't block me if I can come back sooner"). Pick a tape and press ▶. A CRT screen with scanlines "plays" the note with an old-cassette effect. Then the first step appears with a 10-minute timer. Pressing **"I'm back on it"** records how many minutes it took to actually start.

People come back because the calendar reminder brings them to the tape on their return date.

## Inspiration & Identity
- Visually connected to NO SIGNAL, which has its own VHS recording system.
- Old CRT television, long scanlines across the screen, playing an old cassette. Evokes the era before smartphones.
- Emotional tone: "receiving a message from my past self, back when I was still struggling to figure out how to use AI agents."
- Should feel unique, not like a generic productivity app.
- App interface language: English (e.g., the "I'm back on it" button).

## Why This Matters to the Learner
"Yang paling bikin aku semangat adalah momen saat aku kembali ke project game-ku nanti dan langsung tahu harus ngapain, bukan bengong dan mikir ke arah yang tidak jelas." They'll use it for real: recording a NO SIGNAL tape until 10 January 2027.

## What "Working" Looks Like
The demo, in the learner's words:
1. Record a tape for NO SIGNAL with a return date of 10 January 2027.
2. Show the `.ics` file landing in the calendar, and the tape appearing on the shelf with a countdown.
3. Play a different tape whose return date is today. The CRT screen plays back the note, the first step and a 10-minute timer appear, then press "I'm back on it."

**The "oh, that's cool" beat:** pressing ▶ and watching your own words come back on a flickering CRT screen, followed immediately by "here's your 10-minute first step," with the clock running.

## The POC Boundary
- Record a tape: project name, the four text fields, return date.
- Generate a downloadable `.ics` reminder for the return date.
- Tapes persist between visits.
- Tape shelf: labels with project name and date. Tapes before their date are locked with a countdown and can be played early after a confirmation.
- CRT/scanline playback of the note with an old-tape effect.
- First step + 10-minute timer + "I'm back on it" button that records minutes until restart.

## Later
- Voice recording of the note
- Longer free-form extra notes
- A welcome message/intro when a tape starts playing
- Tape-mechanism sound effects (VHS whirring)

## Explicitly Cut
- Nothing cut outright yet. The learner moved everything beyond the core loop to Later rather than discarding it.
