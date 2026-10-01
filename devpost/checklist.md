---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast (chosen by the learner at the start of `5-build`)

## Slices

- [x] **1. You can record a tape and see it on the shelf, even after closing the app**
  Becomes usable: The app opens inside the CRT frame on the Tape Shelf, in VT323 with the status colors. With no tapes it shows the blank "Record your first tape" tape and ● REC. ● REC opens the Record Screen: the ● REC camcorder clock, the tape label (project name, return date from today), and the four questions on one screen. ■ STOP with a missing project name, return date, or first step marks those fields red and shows "TAPE INCOMPLETE" without clearing anything. ■ STOP with all three saves the tape to localStorage and shows "TAPE SAVED". Back on the shelf, each tape shows its project name, VCR date, and state: gray "N DAYS" if locked, green "READY" if due today or earlier, sorted READY first, then locked nearest first. Tapes are still there after closing and reopening the page.
  Why now: Opening the app, recording a tape, and seeing it on the shelf is the "pause" half of the kernel. It also sets up the whole project: the local server, VT323 font and license, file structure, CSS variables, screen switching, and the data model every later slice uses. Date handling in local time is the riskiest logic in the app, because a UTC slip would make a tape due today show as locked in WIB before 07:00, so it's verified first.
  PRD ref: `prd.md > The Core Journey` (steps 1–5), `prd.md > Tape Shelf`, `prd.md > Recording a Tape`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`, `spec.md > File Structure`, `spec.md > Stack`, `spec.md > Look and Feel` (Colors, Type, CRT frame), `spec.md > Screen Switcher (js/app.js)`, `spec.md > Tape Store (js/store.js)`, `spec.md > Tape Rules (js/tapes.js)`, `spec.md > Tape Shelf (js/shelf.js)`, `spec.md > Record Screen (js/record.js)`, `spec.md > Data Model`
  Build: Download VT323 and its OFL license from the Google Fonts GitHub repository into `assets/fonts/`. Write `index.html` with every screen as `<section data-screen="…">` in the CRT frame and the VHS overlay element (effects come in slice 3). Write `css/base.css` with the color and font variables, `@font-face`, the CRT frame, and the shelf and record layouts. Add `js/app.js` (screen switching; `--vhs` values are set per screen and styled later), `js/store.js`, `js/tapes.js` (`todayLocal`, `tapeState`, `daysUntil`, `sortTapes`, `formatVcrDate`), `js/shelf.js`, and `js/record.js`, with all paths relative for GitHub Pages. The Tape Saved screen shows "TAPE SAVED" and a way back to the shelf; its calendar button is added in slice 4.
  Verify (mechanical): Serve with `python -m http.server 8000` and confirm `index.html`, all CSS and JS, and the font return HTTP 200 with no console errors. Run the `tapes.js` helpers under Node: `todayLocal()` matches the Windows local date, and does not use UTC at 00:00–06:59 WIB; `daysUntil` gives the right count; `sortTapes` orders READY, then locked nearest first, then completed; `formatVcrDate('2027-01-10')` returns `10 JAN 2027`. Load the page in headless Edge, record tapes due today and 10 Jan 2027 through the form, and confirm the stored JSON matches `spec.md > Data Model` and the shelf shows READY and a locked "N DAYS" after a reload. Confirm ■ STOP with an empty first step saves nothing and keeps the typed text.
  Learner check: Run `python -m http.server 8000` in the project folder and open `http://localhost:8000`. You should see the shelf in the CRT frame with the blank "Record your first tape" tape. Press ● REC, try ■ STOP with the first step empty (you should see "TAPE INCOMPLETE" and your typing should stay), then fill it in and save. Record a NO SIGNAL tape due 10 Jan 2027 and a second tape due today, close the tab, reopen it, and confirm both tapes are on the shelf, one locked with its day count and one READY in green.
  Commit: `Record tapes and show them on the shelf`

- [x] **2. Pressing ▶ plays your tape back and times your restart**
  Becomes usable: Pressing ▶ on a READY tape shows the blue VCR screen, then the answers one by one, earlier ones staying on screen. Empty answers flash a blue "NO SIGNAL", and the first step comes last. The ▶ PLAY counter runs in a corner, and ▶▶ jumps straight to the first step. A 10:00 countdown starts beside "I'm back on it" and keeps counting as amber `+mm:ss` after zero. "I'm back on it" shows "BACK ON IT · N MIN" (minutes since ▶, rounded, minimum 1), and the shelf then shows that tape at the back with its minutes. A locked tape asks "TAPE DUE 10 JAN 2027. PLAY EARLY?" first. A completed tape replays without the timer or button, and its minutes never change. Closing the page mid-timer records nothing.
  Why now: This is the "rewind" half of the kernel, and the scope's "oh, that's cool" beat: your own words coming back, followed by the 10-minute first step. With slice 1 it completes the full pause-to-restart journey, so the early hands-on checkpoint happens here, while feedback can still shape the look and the remaining slices.
  PRD ref: `prd.md > The Core Journey` (steps 6–10), `prd.md > Playback`, `prd.md > First Step and Timer`, `prd.md > Early Play`, `prd.md > Replaying a Completed Tape`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Playback (js/playback.js)`, `spec.md > First Step Timer and Back On It (js/playback.js)`, `spec.md > Early Play Confirmation`, `spec.md > Data Model`
  Build: Write `js/playback.js` with `startPlayback(tape, mode)`: the blue VCR screen for about 1.2 s, reveals about 2.5 s apart, the "NO SIGNAL" panel for empty answers, the ▶ PLAY counter, ▶▶, and the timer computed from the real clock each tick. Leaving playback cancels every pending timer. Add the Early Play Confirmation and Back On It screens. Wire the shelf so READY tapes go to Playback in return mode, locked tapes go to Early Play Confirmation, and completed tapes go to Replay mode. Save only on "I'm back on it", writing `backOnItMinutes` and `completedAt` once.
  Verify (mechanical): Run the minutes rule under Node (seconds since ▶ rounded to the nearest minute, minimum 1, overtime included). In headless Edge, seed a READY tape and a locked tape, press ▶, and confirm the reveal order is where I stopped, still unsure, why it matters, then the first step last; an empty answer shows "NO SIGNAL"; ▶▶ reveals everything and starts the timer. With a shortened clock, confirm overtime shows `+mm:ss` and "I'm back on it" still works. Confirm "I'm back on it" writes minutes once, a replay writes nothing and shows no timer, reloading mid-timer leaves the tape unchanged, and the early-play confirmation's CANCEL leaves the tape locked.
  Learner check: Play the tape due today. Watch your answers appear one by one, let the first step appear, and press "I'm back on it" after a minute or two. Check the "BACK ON IT · N MIN" screen and the tape at the back of the shelf. Press ▶ on the NO SIGNAL tape and choose CANCEL, then replay the completed tape and confirm the timer doesn't appear. Tell me what you noticed and what you'd change about how playback looks and feels.
  Commit: `Play tapes back with the first-step timer`

- [ ] **3. The screen looks and feels like an old VHS tape**
  Becomes usable: A click-through overlay adds scanlines, a soft vignette, and a slow, gentle flicker, with strength set by `--vhs` for each screen: 0.3 on Record, 0.5 on the Shelf and result screens, 1.0 on the blue screen and Playback. Each revealed answer gets a short glitch: a small shift plus a red/blue split. With the browser's reduced-motion setting on, the flicker and glitch stop and the scanlines stay.
  Why now: The effect layer sits on top of screens that now exist, so it can be tuned against real content without touching behavior. It comes after the checkpoint so any feedback on playback's look folds into it. It also answers the learner's recorded unknown about how the VHS effect is made on the web.
  PRD ref: `prd.md > Look and Feel`, `prd.md > Playback` ("Scanlines/effects are visibly stronger here than on the Record Screen")
  Spec ref: `spec.md > VHS layer (css/vhs.css)`, `spec.md > VHS Layer (css/vhs.css)`, `spec.md > Decisions and Open Issues` (The useful unknown)
  Build: Write `css/vhs.css`: the overlay with `pointer-events: none`, scanlines from a repeating gradient whose opacity follows `--vhs`, a slow, low-amplitude flicker, the vignette, the glitch keyframes, and the `prefers-reduced-motion: reduce` rules. Have `app.js` set `--vhs` per screen and `playback.js` add and remove the glitch class on each reveal.
  Verify (mechanical): In headless Edge, take screenshots of the Record Screen and Playback and confirm the scanlines are visibly stronger on Playback (`--vhs` 1.0 vs 0.3), which is the useful-unknown check recorded in the spec. Confirm clicks and typing still reach the form through the overlay. Confirm the flicker cycle lasts several seconds with a small change in brightness, never fast blinking. With reduced motion emulated, confirm the flicker and glitch animations are off and the scanlines remain.
  Learner check: Open the Record Screen, then play a tape, and compare how strong the effect feels on each. Check that typing on the Record Screen is still comfortable. If you can, turn on Windows' "Animation effects: off" setting (Settings > Accessibility > Visual effects) and reload: the flicker and glitch should stop while the scanlines stay.
  Commit: `Add the VHS effect layer`

- [ ] **4. Saving a tape gives you a calendar reminder with your first step**
  Becomes usable: The Tape Saved screen's "Add to calendar (.ics)" button downloads `pause-tape-<project>-<date>.ics`. Opening it in Outlook adds an all-day event on the return date, named after the project, with the first step in the description and an alarm at 08:00.
  Why now: This is the one piece that depends on an outside app, which is the biggest risk left in the plan. It sits after the full journey works so its findings can't block the kernel, and before the README so those findings get written down. The `.ics` is plain text, so the file itself is checked mechanically; only the Outlook and Android results need the learner's devices.
  PRD ref: `prd.md > Calendar Reminder (.ics)`, `prd.md > The Core Journey` (step 4)
  Spec ref: `spec.md > Tape Saved Screen and Calendar File (js/ics.js)`, `spec.md > The .ics file`, `spec.md > Decisions and Open Issues` (Open issues to resolve early in the build)
  Build: Write `js/ics.js`: `buildIcs(tape)`, following RFC 5545 (CRLF line endings, 75-character line folding, escaped text, `DTSTART;VALUE=DATE`, `DTEND` the next day, the first step in `DESCRIPTION`, a `VALARM` with `TRIGGER;RELATED=START:PT8H`), and `downloadIcs(tape)` using a Blob and a download link. Wire the button on the Tape Saved screen.
  Verify (mechanical): Generate the `.ics` for sample tapes, including a first step with commas, a semicolon, and a line break, and a long first step. Check the CRLF line endings, fold lengths, escaping, the all-day date pair, and `TRIGGER;RELATED=START:PT8H`, then parse the file with a small script to confirm the fields round-trip. In headless Edge, confirm the button downloads a file with the expected name and content.
  Learner check: Save a tape and press "Add to calendar (.ics)". Open the downloaded file in Outlook and check that there's an all-day event on the return date, that the first step appears in the description, and that the alarm shows 08:00. Then send the file to your Android phone, open it with Google Calendar, and tell me what happened to the event and the alarm.
  Commit: `Add the calendar reminder file`

- [ ] **5. Anyone can run Pause Tape from the README**
  Becomes usable: `README.md` explains what Pause Tape is and who it's for, how to run it locally, how to clear the saved tapes to rehearse the demo from an empty shelf, and a "Known limitations" section with the actual Outlook and Android findings from slice 4. The font's license is credited. The live GitHub Pages link is left as a placeholder for `6-ship`.
  Why now: It captures the setup and the calendar findings while they're fresh, and gives the repository what a reader needs to run the app before `6-ship` makes it public. It's last because it describes what the build actually produced.
  PRD ref: `prd.md > Deferred From the POC` (no in-app delete, so rehearsal happens through storage), `prd.md > Calendar Reminder (.ics)`
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`, `spec.md > File Structure` (README.md), `spec.md > The .ics file` (limitations go in the README), `spec.md > The VCR font file`
  Build: Write `README.md` with the project description, the local run steps (`python -m http.server 8000`, then `http://localhost:8000`), the demo-rehearsal step (DevTools > Application > Local Storage > delete `pausetape.tapes.v1`), the Known limitations from slice 4, and the VT323 license credit. Leave a placeholder for the live link.
  Verify (mechanical): Follow the README from a clean clone into a temporary folder: start the server, load the app, and confirm it runs. Check that every file path the README mentions exists, and that the limitations match what slice 4 found.
  Learner check: Read the README as if you were a judge seeing the project for the first time. Tell me whether anything is unclear or missing.
  Commit: `Add README with run steps and known limitations`

## Hands-on Checkpoints

- [x] Early usable behavior explored — after slice 2, the full pause-to-restart journey works in the browser; the learner records, plays back, and times a restart, and gives feedback that can shape the VHS effect layer and the remaining slices. Learner feedback: all five learner-check steps behaved as expected; the pacing (blue screen about 1.2 s, about 2.5 s between answers) feels right; the look is "still too plain" and needs polish, with shader.se as the visual reference; the VHS effect during playback should be clearly visible, "not too subtle and not too strong."
- [ ] Calendar device test — after slice 4, the learner opens the `.ics` in Outlook and on their Android phone and reports what happened; the agent can't operate those apps, and the findings go into the README in slice 5
- [ ] Final kick-the-tires exploration and feedback completed

## Final Review

- [ ] Room around the TV (learner request, built here): a layered room (wall with a window, desk, unbranded drink can, photo frame with a fixed photo) that moves opposite to the cursor, window light as its own layer, VHS effects kept inside the screen, still on touch screens and with reduced motion. The learner supplies the room art before this review; AI art must have no logos or watermarks and is credited in the README.
- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: not started
Route and stops: not started
Edit outcome: not started
Reflection: not started
Activity mode: not started

## Revisions

- The ● REC, ■ STOP, and ▶ symbols are drawn as small CSS shapes instead of typed characters — VT323 has no glyphs for ●, ■, or ▶ (checked in the font's character map), so typed symbols would fall back to a different font on each computer.
- The Playback screen has a ■ STOP button that returns to the shelf without recording anything, the same as closing the page — a replayed tape shows no timer and no "I'm back on it" button, so without it there was no way back to the shelf.
