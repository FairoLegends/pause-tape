---
doc: prd
status: approved
---

# Pause Tape — Product Requirements

A VHS-styled app for pausing a side project cleanly: record a "tape" to your future self when you stop, and play it back when you return so you know exactly what to do next. For anyone with a side project they've had to put on hold; the first real user is the learner, pausing **NO SIGNAL** until 10 January 2027.
Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`.

App interface language: English (`scope.md > Inspiration & Identity`).

## The Core Journey
Source: `scope.md > The Core Loop`, `scope.md > What "Working" Looks Like`.

1. **Open the app.** The whole app sits inside a CRT TV frame with scanlines. The TV first shows a still **standby screen** with the tape status, e.g. **"▶ 1 TAPE READY"**, and the VCR beside the TV glows green when a tape is due. Clicking the VCR opens the **Tape Shelf** on the TV (learner revision during the build; see `Product Decisions`).
2. **First use:** the shelf holds one blank tape reading **"Record your first tape"**, plus the **● REC** button.
3. **Press ● REC.** The **Record Screen** opens: a camcorder-viewfinder look with a **● REC** indicator and a running timer at the top. On one screen: the tape label (project name, return date) and the four message questions.
4. **Press ■ STOP.** If the required fields are filled in, the tape is saved and a short **"TAPE SAVED"** screen appears with an **"Add to calendar (.ics)"** button.
5. **Back to the shelf.** The new tape appears. If its return date is in the future, it's locked with a countdown. If the return date is today, it glows **READY**.
6. **Later, on or after the return date** (brought back by the calendar reminder), open the app and see the tape on the shelf showing **READY**.
7. **Select the tape and press ▶.** A brief blue VCR screen appears, then the **Playback Screen**: the answers appear one by one with a short VHS glitch, each staying on screen. A **▶ PLAY** counter runs in the corner. **▶▶** skips the rest of the playback.
8. **The first step appears last**, immediately followed by a **10-minute timer**.
9. **Press "I'm back on it."** A short result screen shows e.g. **"BACK ON IT · 4 MIN"** (minutes counted from pressing ▶).
10. **Back to the shelf.** The tape stays there, its label now showing the minutes. It can be replayed to re-read the note.

**Success:** the learner returns to a paused project, plays the tape, sees the first step, and starts working within minutes. The shelf keeps proof of how fast they got going again.

## Screens and Layout
All screens live inside the same CRT TV frame.

- **Standby screen** (what the TV shows first): a still screen with the tape status (e.g. "▶ 1 TAPE READY"); clicking the VCR opens the shelf.
- **Tape Shelf** (home): the rack of tapes plus the **● REC** button. Each tape's label shows the project name and return date, plus a state (see `Features and Behavior > Tape Shelf`).
- **Record Screen**: camcorder viewfinder with **● REC** and a running timer at the top. Label fields (project name, return date) and the four message questions on one screen. **■ STOP** saves.
- **Tape Saved Screen**: brief "TAPE SAVED" confirmation with the **"Add to calendar (.ics)"** button, then back to the shelf.
- **Early Play Confirmation**: shown when pressing ▶ on a locked tape.
- **Blue VCR Screen**: a brief transition when a tape is inserted/played.
- **Playback Screen**: the answers appear one by one, with **▶ PLAY** counter in a corner, **▶▶** skip, then the first step and the 10-minute timer with the **"I'm back on it"** button.
- **Back On It Screen**: brief result, e.g. "BACK ON IT · 4 MIN", then back to the shelf.

"One screen for everything" in recording was chosen deliberately: "six separate steps feel slow, both in use and in the demo video."

## Look and Feel
Source: `scope.md > Inspiration & Identity`.

**Overall:** like an old CRT TV and VCR from before smartphones; watching an old recording of yourself, not filling out a form. Connected to NO SIGNAL's visual world but **nostalgic, not scary**.

**Typography (two faces, each with a job):**
- Blocky VCR on-screen-display font for labels, buttons, and indicators: ● REC, ▶ PLAY, READY, countdowns, tape labels. The app should feel like an old TV the moment it opens.
- Clean monospace for the learner's own answers, so the message is quick to read and understand on return.

**Color, where every color means something:**
- Base: blue-black, like CRT glass. Text: faded white.
- **Red:** only for ● REC (recording).
- **Green:** READY and ▶ PLAY (ready to play).
- **Dim gray:** locked tapes (not yet time).
- **VCR blue screen:** when a tape is inserted or played, and for empty answers ("NO SIGNAL"). Ties to the game's name.
- Overtime on the timer uses a distinct color (see `Features and Behavior > First Step and Timer`).

**Effects carry meaning, not decoration** (a principle taken from NO SIGNAL, where VHS effects intensify as danger approaches):
- Scanlines are **thin** while recording, so typing is comfortable.
- Scanlines and effects are **strongest** while a tape plays.
- A short VHS glitch accompanies each answer appearing during playback.

**References from NO SIGNAL:**
- Camcorder viewfinder with timestamp and REC indicator → the Record Screen.
- The hub's tape-player TV for "Recovered Tapes" (recordings from a previous crew) → the Playback Screen. Here, the tape is a message from yourself.
- The hub's Archive Terminal (CRT screen) → the Tape Shelf as a project archive.

**Avoid:** horror mood and heavy static. "It feels scary instead of nostalgic."

**The room around the TV** (learner addition during the build, made in the final review; revised with the learner, designed first as an HTML mockup at `devpost/room-mockup.html` before touching the app):
- A real 3D room built with three.js, in a semi-cartoon style: a tall **bookshelf** on the left; a **sofa** on the left facing right and an **armchair** on the right facing left, straight across a low **table** with stacks of books and loose papers; a **long low sofa** in front of the table facing the TV, set a little to the left so a walkway leads into the TV area (the learner asked that nothing stand in front of the photo frame); a wall with a window and **curtains**; the low **cabinet** holding the TV, a VCR player on its right, a photo frame at its left end and a **table lamp** with a pull cord at its right end; a classic carved **grandfather clock** on the floor right of the cabinet (from the learner's photo: arched crown with a carved crest, carved pillars, cream dial, glass door with a swinging brass pendulum and three weights; it shows the real time); and three **paintings** (rice terraces above the bookshelf; a volcano and flowers right of the window). The positions, sizes and camera follow the learner's written layout spec (see `spec.md`). The learner approved this as version 1 of the room; polish waits until the room is in the app. (The first version's side table and drink can were removed after the learner marked up a screenshot. The learner then found the left side too empty and asked for the bookshelf, the sofa, the lamp and the curtains.)
- The camera turns slightly with the cursor, so the room feels three-dimensional. The VHS effects stay inside the TV screen.
- **The bookshelf is arranged by a generator** (learner request, 5 Oct 2026: a leaning book floated because nothing was under its lean, and the learner wanted the books in different places every time someone opens the site). `js/books.js` places roughly 60 to 80 books each time the page opens, so every visit shows a different shelf: books of different widths, heights and colors, one or two shelves half empty, and up to four leaning books. A leaning book always rests on a standing neighbour that has another book behind it; it never leans on empty air. `?books=<number or any word>` fixes one arrangement, for filming the demo video and for the checks.
- The objects are simple, rounded 3D shapes made in code; AI-generated art is used only for flat pictures: the view outside the window (a day and a night picture) and the three paintings, so light can really fall on the objects and the VCR can be clicked. The view outside is drawn in the same semi-cartoon style as the room (the learner found a realistic street outside a cartoon room wrong) and is seen side-on across a road, not down a road toward the house. The night picture is made from the day picture, so every house and tree stays in the same place (the learner noticed two separately generated pictures didn't match). The moon is drawn by the room itself (lined up with the moonlight), not painted into the night picture, so the window shows one moon (the learner saw two). AI art must carry no logos, trademarks, or watermarks, and it's credited in the README.
- Light follows the visitor's real local time: morning 05–10 warm and soft, day 10–15 bright, afternoon 15–18 orange, night 18–05 moonlit blue with the TV as the main light. Changes between periods are gradual. For the demo video, `?time=morning|day|afternoon|night` picks a period (learner agreed).
- The sun is visible in the window's upper-left corner, and soft shafts of light run from the window down toward the TV along the same direction the real light travels (learner's drawing on a screenshot: orange = light source, yellow = light direction). The shafts fade out when the camera moves in on the TV so they never cover the screen.
- **Things to click:** the VCR opens the shelf on the TV; the **curtain** (click the window or the curtain) closes and opens like cloth: the folds bunch up when open and flatten when closed, the hem trails behind and swings back while it moves, and it breathes a little at rest; a closed curtain dims the room and hides the sun and its shafts. The **lamp** has a pull cord: drag the bead down and let go (it springs back, wobbles and settles) or just click the lamp; it also comes on by itself in the evening and at night. The **photo frame** opens the file picker.
- **Playing a tape (VHS mode):** on the shelf, click a READY tape (a tape still waiting says NOT YET). The camera pulls back so the VCR shows, the cassette slides into the VCR, the TV shows the blue loading screen for about 3 seconds, then the camera eases in to the TV screen and the replay starts. BACK / EJECT or Escape returns to the room.
- **The photo frame is the player's own small decoration:** it starts as an empty slot ("YOUR PHOTO"); the player picks a picture and the **PHOTO panel** opens: a preview in the frame's shape, drag to move the picture, a ZOOM slider (and the mouse wheel), CHANGE, RESET, REMOVE and DONE. The picture is shrunk and kept only in this browser with its zoom and position (localStorage, never uploaded); clicking the frame again reopens the panel. Moved here from Later at the learner's request ("the player can move and zoom their photo, in a new panel").
- On touch screens (no cursor) and with the browser's reduced-motion setting, the camera stays still (derived from the learner's reduced-motion rule).
- **Polish (learner list, 2 Oct 2026):** clickable things glow and show their name when the pointer is over them, fading in and out; soft baked shadows ground the furniture; dust drifts in the window light; a light warm grade, vignette and film grain over the room; sound made in code (rain, the clock, quiet lo-fi, VCR click, tape going in, the loading whirr, a soft tick as letters appear and a blip per answer, the lamp's switch, the curtain sliding, TV static, a timer alarm) that only starts after the player turns it on, with a clear SOUND button in the top-left corner; ROOM CONTROLS with REDUCE MOTION and HIGH CONTRAST; a HOW IT WORKS panel with the AI model and prompts; a loading screen with an estimate; phones keep the flat TV with 44 px buttons.
- Why: "I want to bring the atmosphere to life, so it feels more interactive and nicer to look at."

## Features and Behavior

### Tape Shelf
Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

The home screen. Shows every saved tape and the ● REC button.

Tape states, readable at a glance by color:
- **Locked** (return date in the future): dim gray, shows a countdown in days remaining (e.g. "102 DAYS").
- **READY** (return date is today or has passed, not yet played to completion): glows green with "READY".
- **Back on it** (minutes already recorded): label shows the minutes, e.g. "BACK ON IT · 4 MIN". Replayable.

**Shelf order:** READY tapes first, then locked tapes with the nearest return date first, then completed tapes last.

- As the learner, I want to see all my paused projects as tapes so that when I return I immediately see where to start.
  - [ ] Opening the app shows the standby screen inside the CRT frame with scanlines, with the tape status (e.g. "▶ 1 TAPE READY"); the VCR glows green when a tape is due, and clicking the VCR opens the Tape Shelf.
  - [ ] With no tapes, the shelf shows one blank tape reading "Record your first tape" and the ● REC button.
  - [ ] Each tape label shows the project name and return date.
  - [ ] A tape with a future return date appears dim gray with a countdown in days.
  - [ ] A tape whose return date is today or earlier appears green with "READY".
  - [ ] A tape that has been completed shows its recorded minutes on the label.
  - [ ] Tapes appear in order: READY first, then locked (nearest return date first), then completed last.
  - [ ] Tapes are still on the shelf after closing and reopening the app.

### Recording a Tape
Source: `scope.md > The Core Loop` (Pause).

Pressing ● REC opens the Record Screen. Everything is on one screen:
- **Tape label:** project name, return date.
- **The message (four questions):** where I stopped; the first step when I come back (small, about 10 minutes); what I'm still unsure about; why this project matters to me.

A ● REC indicator with a running timer sits at the top, like a camcorder recording. Pressing **■ STOP** saves the tape.

**Required fields:** project name, return date, and first step, "because without them the tape can't work: no label on the shelf, no reminder, and no step for the timer." The other three answers are optional: "I don't want to be forced to fill in something that doesn't exist, like when I'm not unsure about anything."

**Return date:** date choices start from today; past dates can't be picked. Today is allowed.

- As the learner, I want to record where I stopped and my first step in one go so that pausing is quick.
  - [ ] Pressing ● REC opens the Record Screen with the ● REC indicator and a running timer at the top.
  - [ ] Project name, return date, and all four questions are on a single screen.
  - [ ] Past dates can't be selected; today can.
  - [ ] Pressing ■ STOP with project name, return date, and first step filled in saves the tape and shows "TAPE SAVED".
  - [ ] Pressing ■ STOP with any of those three empty does not save; the empty required fields are marked red with "TAPE INCOMPLETE", and everything already typed is still there.
  - [ ] A tape can be saved with any of the three optional answers left empty.

### Calendar Reminder (.ics)
Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

The "TAPE SAVED" screen offers **"Add to calendar (.ics)"**, which provides a calendar file for the return date so the reminder lands in the phone or laptop calendar.

The event is **all-day** on the return date, named after the project. Its **description contains the first step**, and it has a **morning alarm at 08:00 WIB** on the return date, so the reminder itself says what to do.

**The tape link** (Learner choice, 7 Oct 2026, after an honest review of the Potential Impact criterion: a tape locked for months lived only in one browser's storage, which Safari may clear after 7 days of use without a visit and which a phone or another browser never had. The learner chose the full tape in the link over plain answers in the calendar note, so the answers stay unread until the tape plays.) The description ends with **"Play the tape:"** and a link to the app that carries the whole tape. Opening it in any browser puts the tape on that browser's shelf if it isn't there yet, and plays as usual from there. The answers in the link are packed, not encrypted: anyone with the link can read them. The voice note doesn't travel.

- As the learner, I want a calendar reminder on my return date so that I actually come back.
  - [ ] Pressing "Add to calendar (.ics)" produces an `.ics` file.
  - [ ] Opening the file adds an all-day event on the tape's return date to a calendar app, named after the project.
  - [ ] The event's description contains the tape's first step.
  - [ ] The event has an alarm at 08:00 WIB on the return date.
  - [ ] The event's description ends with "Play the tape:" and a link; opening that link in a browser with an empty shelf shows the tape there, with the same answers.
  - [ ] Opening the link where the tape already is changes nothing; a damaged link says "THAT TAPE LINK IS BROKEN" and adds nothing.
  - [ ] Leaving the "TAPE SAVED" screen returns to the shelf with the new tape shown.

### Early Play
Source: `scope.md > The Core Loop` ("so it still feels like a message from the past, but doesn't block me if I can come back sooner").

VCR-style confirmation: **"TAPE DUE 10 JAN 2027. PLAY EARLY?"** (with the tape's own date) and two buttons, **▶ PLAY** and **CANCEL**.

- [ ] Pressing ▶ on a locked tape shows "TAPE DUE [date]. PLAY EARLY?" with ▶ PLAY and CANCEL.
- [ ] ▶ PLAY plays the tape normally (full Playback, first step, timer, minutes).
- [ ] CANCEL returns to the shelf; the tape stays locked.

### Playback
Source: `scope.md > The Core Loop` (Rewind), `scope.md > What "Working" Looks Like`.

Pressing ▶ shows a brief blue VCR screen, then the answers appear **one by one**, each with a short VHS glitch, and each stays on screen. **The first step appears last.** A **▶ PLAY** counter runs in a corner (the pair to ● REC). **▶▶** skips the rest of the playback straight to the first step.

Why one by one: "so it feels like watching an old recording of myself, not reading a boring form." Why ▶▶: "I don't want to be forced to wait if I already remember." Why the first step last: "it's the most important part. As soon as it appears, the timer starts and I start working, not staring."

**Empty optional answers** briefly appear as a blue "NO SIGNAL" screen in their place.

- As the learner, I want my note played back like an old tape so that it feels like a message from my past self.
  - [ ] Pressing ▶ on a READY tape shows a brief blue VCR screen, then the Playback Screen.
  - [ ] Answers appear one at a time with a glitch effect; earlier answers stay visible.
  - [ ] The ▶ PLAY counter runs in a corner during playback.
  - [ ] An empty optional answer shows briefly as a blue "NO SIGNAL" screen.
  - [ ] The first step is the last thing to appear.
  - [ ] Pressing ▶▶ skips straight to showing everything, including the first step, and the timer starts.
  - [ ] Scanlines/effects are visibly stronger here than on the Record Screen.

### First Step and Timer
Source: `scope.md > The Unique Kernel`.

As soon as the first step appears, a **10-minute countdown** starts with the **"I'm back on it"** button.

If the timer reaches zero before the button is pressed, it keeps counting **overtime** (e.g. "+01:23") in a different color, and the button still works. "The 10-minute timer is a nudge to start, not a punishment. If I needed 13 minutes, that still means I made it back, so the number has to be honest."

Pressing **"I'm back on it"** shows a brief result screen, e.g. **"BACK ON IT · 4 MIN"**. Minutes are counted **from pressing ▶**. Then it returns to the shelf.

- As the learner, I want a 10-minute first step with a timer so that I start working right away.
  - [ ] The 10-minute countdown starts the moment the first step appears.
  - [ ] "I'm back on it" is visible alongside the timer.
  - [ ] After 10 minutes, the timer shows overtime (e.g. "+01:23") in a different color and the button still works.
  - [ ] Pressing "I'm back on it" shows "BACK ON IT · N MIN", where N is minutes since ▶ was pressed (including any overtime).
  - [ ] Back on the shelf, that tape's label shows the minutes.
  - [ ] If the app is closed while the timer is running, no minutes are recorded; on reopening, the tape is still READY and plays again from the start.

### Replaying a Completed Tape
Source: learner decision during the PRD interview.

A tape that already has minutes can be played again to re-read the note, "if I forget again." Replaying is for remembering, not returning from a pause.

- [ ] Replaying a completed tape plays the answers as in Playback.
- [ ] No timer and no "I'm back on it" button appear on replay.
- [ ] The minutes on the label never change after the first time.
- [ ] To pause the same project again, the learner records a new tape.

## States and Boundaries
- **First use / empty shelf** — one blank tape reading "Record your first tape" plus ● REC.
- **Incomplete tape** — ■ STOP with a missing project name, return date, or first step: not saved; required fields marked red with "TAPE INCOMPLETE"; typed answers kept.
- **Empty optional answer** — during playback, shown briefly as a blue "NO SIGNAL" screen.
- **Locked tape** — dim gray with a countdown in days; playable early after the "PLAY EARLY?" confirmation.
- **Return date today** — tape is READY immediately (needed for the demo).
- **Timer overtime** — keeps counting as "+mm:ss" in a different color; button still works.
- **App closed mid-playback or mid-timer** — nothing is recorded; the tape stays READY without minutes and plays again from the start. A locked tape played early returns to locked.
- **Completed tape** — label shows minutes; replays without timer/button; minutes never overwritten.
- **Persistence** — tapes, including their answers and recorded minutes, remain after closing and reopening the app. The app asks the browser to keep them for good (persistent storage), and the calendar event's tape link brings a tape back to any browser.

## Product Decisions
- **The TV starts on a standby screen, and clicking the VCR opens the shelf** (revised during the build; this replaces "the shelf is the first screen") — the standby screen still shows the status, e.g. "▶ 1 TAPE READY", and the VCR glows green when a tape is due, "so I still know right away that a tape is waiting, and opening the shelf feels like turning on a real VCR." The original reason still holds: on return, "I immediately see the tape I recorded before, so I know what to do."
- **Recording is one screen, not steps** — six separate steps feel slow in use and in the demo video.
- **● REC / ■ STOP / ▶ PLAY / ▶▶ vocabulary** — recording and playing should feel like a camcorder and VCR.
- **Only project name, return date, and first step are required** — without them the tape can't work; the rest shouldn't be forced.
- **Dates start from today; today is allowed and immediately READY** — no past dates, and the demo needs a tape due today.
- **Locked tapes can be played early after confirmation** — still feels like a message from the past, without blocking an early return.
- **Answers appear one by one with ▶▶ to skip** — feels like watching a recording, without forcing a wait.
- **First step appears last, then the timer starts immediately** — it's the most important part; it turns into action right away.
- **Minutes are counted from pressing ▶** — learner's choice.
- **Overtime keeps counting, honestly** — the timer is a nudge, not a punishment.
- **Completed tapes stay on the shelf with their minutes, never overwritten** — they're proof of actually coming back; replays are for remembering.
- **Pausing the same project again means a new tape** — each tape is one pause-and-return.
- **Countdown in days** — learner confirmed.
- **Shelf order: READY first, then locked by nearest date, completed last** — "what can be played right away has to be the first thing I see when I come back, so I don't have to hunt for it among the locked tapes. Completed tapes go last because they're just proof, not something I have to work on now."
- **Calendar event is all-day, its description holds the first step, and it has a morning alarm at 08:00 WIB** — "when the reminder pops up on my phone, I already know my first step before even opening the app. So when the return day comes, I know what to do right away, not staring."
- **Early-play wording is VCR-style: "TAPE DUE [date]. PLAY EARLY?" with ▶ PLAY / CANCEL** — keeps the VCR language.
- **Closing the app mid-timer records nothing; the tape stays READY and replays from the start** — learner's addition.
- **A locked tape played early and interrupted returns to locked** — "its return date still hasn't arrived."
- **Two typefaces, color = status, effects carry meaning** — see `Look and Feel`.
- **A real 3D room around the TV (three.js, semi-cartoon), the camera turning with the cursor, light following the real time of day, built in the final review; AI art only for the window view (cartoon, side-on); a bookshelf and sofa, a lamp and a curtain the player can click; a photo frame where the player can put their own picture** — see `Look and Feel`.

**Assumptions (not learner decisions yet):**
- None remaining.

## What We're Building
- Tape Shelf with empty state, locked/READY/completed tape states, shelf order, and ● REC.
- Record Screen: one-screen form, required-field validation ("TAPE INCOMPLETE"), date picker starting from today, ■ STOP to save.
- Tape Saved Screen with "Add to calendar (.ics)": all-day event, first step in the description, morning alarm at 08:00 WIB.
- Early Play confirmation ("TAPE DUE [date]. PLAY EARLY?").
- Playback: blue VCR screen, one-by-one answers with glitch, ▶ PLAY counter, ▶▶ skip, "NO SIGNAL" for empty answers.
- First step + 10-minute timer with overtime + "I'm back on it" + "BACK ON IT · N MIN".
- Replay of completed tapes without timer.
- Tapes persist between visits.
- The Look and Feel above: CRT frame, scanlines varying by screen, two typefaces, status colors.
- The room around the TV (built in the final review): a 3D room with the camera turning with the cursor, light by time of day, a clickable VCR that opens the shelf, a curtain and a lamp with a pull cord the player can use, a tape-insert and loading sequence into the VHS replay, a photo frame that takes the player's own picture with a PHOTO panel to zoom and move it, and a bookshelf whose books are arranged anew on every visit.

## Core Additions (learner choices, 3 Oct 2026)
The learner asked what could be added to the core while there is time left, and chose all of these:
- **Sample tape for judges:** while the shelf has none of the player's own tapes, a READY tape "Pause Tape" (badge SAMPLE) sits beside the blank "Record your first tape", so a first-time visitor can play the whole loop at once. It is never saved; "I'm back on it" leaves it READY. The learner chose the name and let the agent write its four answers. It can be erased, and stays gone.
- **Intro line when a tape plays:** "MESSAGE FROM [recorded date] · [N] DAYS AGO" (TODAY / 1 DAY AGO), on its own for a moment before the first answer.
- **PAUSE AGAIN** on the BACK ON IT screen: a new Record Screen with the project name filled in (only the name, learner choice).
- **Erasing a tape:** an eject button on every tape, then "ERASE [PROJECT]? THIS CAN'T BE UNDONE." with ERASE / CANCEL. Erasing is permanent (no archive shelf, learner choice).
- **Stat line above the shelf:** "AVERAGE BACK ON IT · N MIN · N TAPES", the average over completed tapes (shown once one is completed).
- **Backup:** BACKUP downloads the tapes as a `.json` file; RESTORE adds the tapes from such a file that aren't on the shelf yet. The photo is not included (learner choice).
- **Timer alarm:** three soft beeps when the 10 minutes run out (with sound on).
- **Voice note:** an optional spoken message of at most 40 seconds on the Record Screen (RECORD VOICE → STOP VOICE, LISTEN, DELETE, RECORD AGAIN), stored in this browser's IndexedDB because localStorage is too small for audio (learner approved). It plays on its own row (‖/▶ and a progress bar) right after the intro line while the written answers follow. The shelf marks such tapes VOICE. Without a microphone, or if access is refused, the tape works the same without it. Backups and erasing: the note isn't in the backup file; erasing the tape deletes it.

## Seasons Outside the Window (learner request, 3 Oct 2026)
- A **SEASON** row in the room controls: AUTO, SNOW, SPRING, SUMMER, DRY. AUTO follows the month (Dec–Feb snow, Mar–May spring, Jun–Aug summer, Sep–Nov dry season / kemarau). The choice is saved; `?season=` sets it for a demo.
- Each season has its own AI day picture (learner choice: four new Seedream pictures, accepting that the houses sit a little differently in each) and a night picture made from it, so day and night match.
- Weather outside the glass: falling snow, drifting spring petals, dry leaves; a heat shimmer over the road in summer.
- The ambience follows the season (learner choice): a soft cold wind in snow, birds in spring, cicadas and crickets in summer, a dry gusty wind with rustling leaves in the dry season. Rain plays only when RAIN ON is picked.

## Alive Room Round (learner requests, 5 Oct 2026)
- **Wind by day:** a breeze moves the trees, palms and low plants outside the window, not the houses. Stronger in the dry season, softer in snow; none at night or with REDUCE MOTION. The curtain stirs with it.
- **Fireflies:** on a calm night outside winter, soft yellow-green lights drift over the gardens. Not in the rain, not by day.
- **Water on the glass:** with RAIN ON, small beads run down the pane and leave wet trails (the learner found the first beads too big, so they were halved).
- **Sound, redesigned:** the outdoor sound follows the season (4), the time of day (4) and the curtain (closed = duller and quieter). The rain is a real recording, "Rain (on the window)" by DonRain (Pixabay Content License), because the learner found the code-made rain strange; the code-made rain stays as a fallback if the file cannot load.
- **Simon, the cat:** a sleeping cat on the floor, new pose and coat on every visit (curled, loaf, side, sploot, croissant, sphinx; belly-up exists but is not picked, because it read as a fallen cat). He breathes slowly; his name SIMON shows when the pointer is on him, and on a tap on a touch screen. `?cat=` and `?pose=` fix him for filming.
- Why: "I want the room to feel alive." Everything is still made in code except the rain recording and the pictures.

## Deferred From the POC
- **Archiving tapes** — the learner chose permanent erase instead (see Core Additions).
- **Editing a saved tape** — not discussed; not needed for the demo. Record a new tape instead.
- **Accounts and syncing across devices** — tapes live where the app is used; the demo doesn't need more. The calendar's tape link (see Calendar Reminder) carries one tape to another device without an account.
- **In-app notifications** — the `.ics` calendar reminder covers "come back on the date."

## Possible Later Enhancements
From `scope.md > Later` and this interview:
- Longer free-form extra notes.

## Non-Goals
- **Horror mood or heavy static** — Pause Tape should feel nostalgic, not scary.
- **A full project manager** (tasks, issues, progress tracking) — the tape holds one message and one first step; the learner already has a GDD and `issue.md` for the rest.
- **Being forced to fill everything in** — only what the tape needs to work is required.

## Open Questions
- None blocking `4-spec`.
