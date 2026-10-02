---
doc: spec
status: approved
---

# Pause Tape — Technical Spec

## How This Works, In Plain Language
Pause Tape is **one web page** made of three kinds of files, the same three every website uses:

- **HTML** is the scene hierarchy. `index.html` holds every screen (shelf, record, tape saved, early play, blue VCR screen, playback, back on it) as nested elements, the way a Unity scene holds nested GameObjects. Only one screen is visible at a time; switching screens is the web version of `SetActive(true/false)`.
- **CSS** is the materials and look: colors, the two fonts, the CRT frame, and the VHS effects.
- **JavaScript (JS)** is the scripts: button clicks (like `Button.onClick`), the timers (like `Update()`), saving tapes, building the calendar file.

**Where tapes live:** in the browser's **localStorage**, the web's `PlayerPrefs`. Like PlayerPrefs it only stores strings, so the list of tapes is turned into JSON text (`JSON.stringify`, like `JsonUtility.ToJson`) when saved and read back when the app opens. Tapes stay in that one browser on that one device. There are no accounts and nothing is sent anywhere.

**The VHS effect:** not a shader. A transparent layer sits on top of the whole screen, like a top-most UI Image with *Raycast Target* off, so clicks pass through. It draws scanlines, a soft vignette, and a slow gentle flicker. Each answer in playback gets a short CSS glitch (a small shift plus a red/blue color split). One number, the CSS variable `--vhs`, controls how strong it all is. JS sets it per screen (about 0.3 while recording, 1.0 during playback), the same way `VHSDriver` sets a float on your fullscreen material. If the browser's "reduce motion" setting is on, flicker and glitch turn off but scanlines stay.

**The calendar file (.ics):** a small text file that JS writes in the browser and hands to you as a download. Opening it adds the return-day event to a calendar app.

**Why this shape:** GitHub Pages only serves files, with no server behind them, and everything Pause Tape needs (saving, the calendar file, the effects, the font) can happen inside the browser. No framework and no install step means the files you write are exactly the files that go online, and what you learn transfers straight to a NO SIGNAL website later.

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`.

1. **Open the app** → the browser loads `index.html`, the CSS, and the JS. `store.js` reads the tape list from localStorage. `shelf.js` works out each tape's state from today's date and draws the shelf. You see the Tape Shelf inside the CRT frame.
2. **First use** → localStorage is empty, so the shelf draws the blank "Record your first tape" tape plus ● REC.
3. **Press ● REC** → `app.js` shows the Record Screen and sets `--vhs` low. `record.js` starts the ● REC clock and sets the date picker's earliest date to today.
4. **Press ■ STOP** → `record.js` checks project name, return date, and first step. If any is missing, those fields turn red, "TAPE INCOMPLETE" appears, and nothing is cleared. If they're all there, a new tape object is added to the list and `store.js` saves the list to localStorage. The Tape Saved Screen appears.
5. **Press "Add to calendar (.ics)"** → `ics.js` writes the event text from the tape and the browser downloads `pause-tape-<project>-<date>.ics`. You open it and your calendar app adds the event.
6. **Back to the shelf** → the shelf is redrawn. The new tape is locked with "N DAYS", or READY if its date is today.
7. **On the return day, press ▶ on a READY tape** → if the tape were locked, `app.js` would first show "TAPE DUE [date]. PLAY EARLY?" `playback.js` records the moment ▶ was pressed, shows the blue VCR screen, sets `--vhs` to full, and starts the ▶ PLAY counter.
8. **Answers appear one by one** → `playback.js` reveals "where I stopped", "still unsure", and "why it matters" in turn with a glitch. Empty ones flash a blue "NO SIGNAL". The first step comes last and the 10:00 countdown starts. ▶▶ reveals everything at once and jumps to that point.
9. **Press "I'm back on it"** → minutes since ▶ are calculated and written onto the tape, and the list is saved. "BACK ON IT · N MIN" shows.
10. **Back to the shelf** → the tape is now completed and shows its minutes at the back of the shelf. Pressing ▶ on it replays the note with no timer and no button.

Nothing is saved between step 7 and step 9. That's what makes "closing the app mid-timer records nothing" and "an interrupted early play goes back to locked" work automatically. See `Data Model`.

## Stack
- **HTML, CSS, and JavaScript, no framework, no build step, no npm.** Learner choice. They want to understand basic web code for a future NO SIGNAL website. Accepted tradeoff: screen switching and drawing the shelf are written by hand instead of by a framework, which is fine for 7 small screens.
  - HTML: https://developer.mozilla.org/en-US/docs/Web/HTML
  - CSS: https://developer.mozilla.org/en-US/docs/Web/CSS
  - JavaScript: https://developer.mozilla.org/en-US/docs/Web/JavaScript
- **JavaScript modules (`<script type="module">`)** so each script file has one job, like separate MonoBehaviours. This is an implementation detail. Modules need the page served over `http://` rather than double-clicked, so a local server is used; see below. Docs: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
- **localStorage** for tapes. Learner choice, because it's like PlayerPrefs, and accounts and sync are deferred. Docs: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- **VHS effects: a three.js shader layer with a CSS fallback**, both driven by the `--vhs` custom property (learner revision during `5-build`; see `Decisions and Open Issues`). The shader sits on top of the HTML and can't bend the text itself, the same way a URP fullscreen pass doesn't touch a Screen Space – Overlay canvas; bending the Playback screen is the planned polish step.
  - three.js r186 (MIT), stored in `assets/vendor/`: https://threejs.org/docs/
  - GSAP 3.15 with ScrambleText (standard no-charge license, which allows use on websites; notices stay in the files), stored in `assets/vendor/`: https://gsap.com/docs/v3/
  - Still no npm and no build step: the library files are served like any other file.
  - Custom properties: https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties
  - Animations: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations
  - `prefers-reduced-motion`: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- **.ics built in the browser** following the iCalendar standard (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545), downloaded with a Blob (https://developer.mozilla.org/en-US/docs/Web/API/Blob) and a download link. No library.
- **VCR font, stored in the project: VT323** (learner choice), under the SIL Open Font License, which allows redistribution in a public repo (https://fonts.google.com/specimen/VT323, license: https://openfontlicense.org). Downloaded and stored in the project, not loaded from Google. VCR OSD Mono was rejected because its license is unclear.
- **Answer font:** the system's own monospace (`ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace`). Implementation detail: clean, readable, nothing extra to download.

## Where It Runs and How Someone Tries It
**Runtime:** any modern browser (Edge or Chrome on the learner's Windows laptop for the build and recording). No API keys, no accounts, no server code.

**Running locally (build and demo recording):** the page has to be served over `http://` because modules and fonts won't load from a double-clicked file. The learner has Python 3.11 installed, so:
- From the project root, run `python -m http.server 8000`, then open `http://localhost:8000`.

**Demo recording** (from `scope.md > What "Working" Looks Like`), all in one screen recording on the laptop:
1. Record a NO SIGNAL tape due 10 Jan 2027.
2. Open the downloaded `.ics` in Outlook. Show the event, then show the shelf with the tape's countdown.
3. Record a second tape due today, press ▶, watch playback, the first step and timer, then "I'm back on it."

To rehearse from an empty shelf, clear the saved tapes in the browser (DevTools → Application → Local Storage → delete the `pausetape.tapes.v1` key). This goes in the README, since in-app deleting is deferred (`prd.md > Deferred From the POC`).

**Deployment (learner choice): GitHub Pages**, free, so judges can open a link directly. Done in `6-ship`, not during the build. The app files sit at the repository root, and Pages is set to "Deploy from a branch" → `main` → `/ (root)`. The URL will be `https://<username>.github.io/<repo>/`, so every file path in the app must be **relative** (`css/base.css`, not `/css/base.css`). Docs: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Submission still needs the demo video and the public repo. The Pages link is a bonus, not a substitute.

## Look and Feel
Carries forward `prd.md > Look and Feel` and `scope.md > Inspiration & Identity`: an old CRT TV and VCR, nostalgic, not scary. Interface copy is English, short, uppercase VCR-style (`● REC`, `▶ PLAY`, `TAPE INCOMPLETE`, `TAPE DUE 10 JAN 2027. PLAY EARLY?`).

### Colors
Colors are CSS variables in `css/base.css`. The exact hex values can be tuned during the build; the meanings are fixed.

| Variable | Use | Starting value |
|---|---|---|
| `--glass` | background, CRT glass | `#070b14` (blue-black) |
| `--ink` | normal text | `#d9dee8` (faded white) |
| `--rec` | ● REC only, plus required-field errors | `#ff3b3b` |
| `--ready` | READY, ▶ PLAY | `#62ff8f` |
| `--locked` | locked tapes | `#6b7280` |
| `--vcr-blue` | blue VCR screen, "NO SIGNAL" | `#1d2fb8` |
| `--overtime` | timer overtime `+mm:ss` | `#ffb020` (amber) |

Red is reused for the "TAPE INCOMPLETE" warning and red fields because the PRD asks for red there (`prd.md > Recording a Tape`).

### Type
- `--font-osd`: the VCR font, for labels, buttons, indicators, counters, and tape labels.
- `--font-answer`: system monospace, for the learner's own answers.

### CRT frame
A rounded "tube" box centered on the page with a dark bezel, the screens inside it, and a soft inner glow and vignette. The layout is a single column and fits a laptop screen for the recording. It must still work on a phone for judges, but that isn't the focus.

### VHS layer (`css/vhs.css`)
- One overlay element on top of everything (`pointer-events: none`).
- **Scanlines:** a repeating horizontal gradient whose opacity follows `--vhs`.
- **Flicker:** a slow, soft brightness change (several seconds per cycle, small amplitude, never fast blinking). Strength follows `--vhs`.
- **Glitch:** a class added to each revealed answer for about 300 ms: a small horizontal shift plus a red/blue text-shadow split. No heavy static, no noise texture.
- **Intensity per screen:** Record `0.3`; Shelf, Tape Saved, Back On It `0.5`; Blue VCR and Playback `1.0`. These are starting values, tuned by eye.
- **Reduced motion** (learner rule): under `@media (prefers-reduced-motion: reduce)`, flicker and glitch animations are off and scanlines stay.

## Components

### Screen Switcher (`js/app.js`)
The entry script. It holds which screen is visible and shows exactly one `<section data-screen="...">` at a time. On every switch it sets `--vhs` on the page root for that screen (the "VHSDriver"). It wires the top-level buttons and starts the app by loading tapes and drawing the shelf.
PRD ref: `prd.md > Screens and Layout`, `prd.md > Look and Feel`.

### Tape Store (`js/store.js`)
`loadTapes()` reads the `pausetape.tapes.v1` key and turns the JSON back into a list; if the key is missing or unreadable, it returns an empty list. `saveTapes(list)` writes the list back. It's the only file that touches localStorage.
PRD ref: `prd.md > States and Boundaries` (Persistence), `prd.md > Tape Shelf`.

### Tape Rules (`js/tapes.js`)
Pure helpers with no screen code:
- `todayLocal()` gives today's date as `YYYY-MM-DD` in the **device's local time**. This must not use `toISOString()`, which is UTC and would give yesterday's date in WIB before 07:00.
- `tapeState(tape)` returns `completed` if the tape has minutes, `ready` if its return date is on or before today, and `locked` otherwise.
- `daysUntil(date)` gives the whole-day difference between local dates, for "102 DAYS".
- `sortTapes(list)` puts READY first, then locked with the nearest date first, then completed. Ties go to the newest recorded first.
- `formatVcrDate(date)` gives `10 JAN 2027`.
PRD ref: `prd.md > Tape Shelf`, `prd.md > Early Play`.

### Tape Shelf (`js/shelf.js`)
Draws the shelf from the sorted list. Each tape is a cassette-shaped button with a label showing the project name, the VCR date, and a state line (`102 DAYS` in gray, `READY` in green, or `BACK ON IT · 4 MIN`). With no tapes, it draws the blank "Record your first tape" tape; pressing it does the same as ● REC. Pressing a tape: READY goes to Playback, locked goes to Early Play Confirmation, completed goes to Replay.
PRD ref: `prd.md > Tape Shelf`.

### Record Screen (`js/record.js`)
One form with project name, return date (`<input type="date">` with `min` set to today), and the four questions. The ● REC clock counts up from when the screen opened, in camcorder style (`● REC 00:00:15`). ■ STOP validates. On failure, it marks the missing required fields red, shows "TAPE INCOMPLETE", and keeps all input. On success, it builds the tape (see `Data Model`), saves it, and shows Tape Saved. The form is cleared only after a successful save.
PRD ref: `prd.md > Recording a Tape`.

### Tape Saved Screen and Calendar File (`js/ics.js`)
The Tape Saved screen shows "TAPE SAVED", the **"Add to calendar (.ics)"** button, and a way back to the shelf. `buildIcs(tape)` returns the event text; `downloadIcs(tape)` wraps it in a Blob and triggers a download. See `External Services and Dependencies > The .ics file` for the exact content.
PRD ref: `prd.md > Calendar Reminder (.ics)`.

### Early Play Confirmation
A small screen showing `TAPE DUE 10 JAN 2027. PLAY EARLY?` with **▶ PLAY** (goes to Playback in normal mode) and **CANCEL** (back to the shelf). It changes nothing in storage.
PRD ref: `prd.md > Early Play`.

### Playback (`js/playback.js`)
`startPlayback(tape, mode)`, where mode is `return` for a READY or early-played tape and `replay` for a completed one.
1. Store the moment ▶ was pressed (`playStartedAt`). This lives in memory only.
2. Show the Blue VCR screen for about 1.2 s with "▶ PLAY", then the Playback screen at `--vhs: 1`.
3. Start the ▶ PLAY counter in a corner (`▶ PLAY 0:00:12`).
4. Reveal in order, about 2.5 s apart: where I stopped, still unsure, why it matters. Each reveal adds the glitch class, and earlier answers stay. An empty answer shows a blue "NO SIGNAL" panel for about 1.2 s in its place, then leaves a dim `NO SIGNAL` line.
5. Reveal the first step last. In `return` mode, start the Timer.
6. **▶▶** cancels the pending reveals, shows everything including the first step with no glitch delay, and starts the Timer in `return` mode.

Leaving playback by any route cancels its timers, so nothing runs in the background.
PRD ref: `prd.md > Playback`, `prd.md > Replaying a Completed Tape`.

### First Step Timer and Back On It (`js/playback.js`)
- A 10:00 countdown next to the first step, updated every second from the real clock (the start time is compared with now each tick, so it can't drift).
- At zero it switches to `+mm:ss` in `--overtime` and keeps counting.
- **"I'm back on it"** calculates minutes since `playStartedAt`, rounded to the nearest whole minute with a minimum of 1. It saves the tape's `backOnItMinutes` and `completedAt`, then shows `BACK ON IT · N MIN` for a few seconds (or until tapped) and returns to the shelf.
- In `replay` mode, neither the timer nor the button is shown.
PRD ref: `prd.md > First Step and Timer`, `prd.md > Replaying a Completed Tape`.

### VHS Layer (`css/vhs.css`)
See `Look and Feel > VHS layer`. The only JS involvement is `app.js` setting `--vhs` and `playback.js` adding and removing the glitch class.
PRD ref: `prd.md > Look and Feel`.

## Data Model
One list of tapes, stored as JSON under the localStorage key `pausetape.tapes.v1`:

```json
[
  {
    "id": "t_1727650000000",
    "project": "NO SIGNAL",
    "returnDate": "2027-01-10",
    "stopped": "…",
    "firstStep": "…",
    "unsure": "",
    "why": "…",
    "recordedAt": "2026-09-30T14:02:11.000Z",
    "backOnItMinutes": null,
    "completedAt": null
  }
]
```

| Data | Where it lives | How it's updated | Leave and come back |
|---|---|---|---|
| The tape list | localStorage | Rewritten in full on ■ STOP (new tape) and on "I'm back on it" (minutes) | Read on open; tapes are still there |
| Tape state (locked / READY / completed) | Not stored; calculated from `returnDate`, today, and `backOnItMinutes` | Recalculated every time the shelf is drawn | A locked tape turns READY on its date without any background job |
| Text typed on the Record Screen | The form, in memory | Typing | Lost if the page is closed before ■ STOP (acceptable for the POC) |
| `playStartedAt`, playback progress, timer | Memory only | Set on ▶, cleared on leaving | Gone, so the tape is unchanged: READY stays READY, a locked tape played early stays locked (`prd.md > States and Boundaries`) |

`backOnItMinutes` is written once. Replay never writes it, so minutes never change (`prd.md > Replaying a Completed Tape`). The `.v1` in the key leaves room to change the shape later without breaking old tapes.

## File Structure
The app lives at the repository root so GitHub Pages can serve it from `/ (root)`.

```
BuildWithAI-Basics/
├── index.html            # All 7 screens as <section data-screen="…">, the CRT frame, the VHS overlay
├── css/
│   ├── base.css          # Color and font variables, @font-face, CRT frame, layout, each screen, tape cassettes
│   ├── vhs.css           # Scanlines, flicker, glitch, --vhs intensity, reduced-motion rules
│   └── room.css          # The 3D room's layers, the app screen on the glass, CRT bend + CSS tube look, room panel, PHOTO panel
├── js/
│   ├── app.js            # Entry: screen switcher, sets --vhs per screen, wires buttons
│   ├── store.js          # localStorage load/save (the only file touching storage)
│   ├── tapes.js          # Date helpers, tape state, shelf sorting, VCR date format
│   ├── shelf.js          # Draws the shelf and the empty state
│   ├── record.js         # Record form, ● REC clock, validation, save
│   ├── ics.js            # Builds and downloads the .ics file
│   ├── playback.js       # Blue screen, one-by-one reveal, ▶ PLAY counter, ▶▶, timer, back on it, replay
│   ├── crt.js            # three.js shader layer over the screen (grain, tracking band, scanlines), follows --vhs
│   ├── room.js           # The three.js room around the TV (laptop/desktop with WebGL); puts the app screen on the TV glass
│   └── motion.js         # GSAP: text tuning in, blue-screen loading bar; the freeze-and-glitch screen change
├── assets/
│   └── fonts/
│       ├── VT323-Regular.ttf    # The VCR OSD font (SIL OFL)
│       └── OFL.txt              # The font's license, kept with the file
│   └── room/                    # The window views and the paintings (AI art, credited in THIRD_PARTY_NOTICES.md)
│   └── vendor/                  # three.js (MIT, with its LICENSE) and GSAP (notices kept in the files)
├── LICENSE               # MIT, the project's own open source license (required by the rules)
├── THIRD_PARTY_NOTICES.md  # Licenses of the bundled font and libraries
├── README.md             # What it is, how to run locally, live link, known limitations (calendar findings)
├── .gitignore            # Already exists: keeps devpost/learner-profile.md and .env files out
├── devpost/              # Devpost learning workspace (planning docs)
├── .claude/ , .agents/ , agent/ , skills-lock.json   # Course tooling, untouched
```

## External Services and Dependencies
No APIs, no keys, no costs. The only outside pieces:

### GitHub Pages
Free static hosting for a public repo. Set up in `6-ship`. No calls from the app. Docs: https://docs.github.com/en/pages

### The .ics file
Written by `ics.js`, following RFC 5545. Lines end with `\r\n`. Long lines are folded at 75 characters. Commas, semicolons, backslashes, and newlines in text are escaped. Example for a tape due 10 Jan 2027:

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Pause Tape//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:t_1727650000000@pause-tape
DTSTAMP:20260930T070211Z
DTSTART;VALUE=DATE:20270110
DTEND;VALUE=DATE:20270111
SUMMARY:▶ NO SIGNAL — tape ready
DESCRIPTION:First step: <the tape's first step>
TRANSP:TRANSPARENT
X-MICROSOFT-CDO-ALLDAYEVENT:TRUE
X-MICROSOFT-CDO-BUSYSTATUS:FREE
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:<the tape's first step>
TRIGGER;RELATED=START:PT8H
END:VALARM
END:VEVENT
END:VCALENDAR
```

- **All-day** is `DTSTART;VALUE=DATE`, with `DTEND` the next day.
- **08:00 WIB alarm** is `TRIGGER:PT8H`, meaning 8 hours after the start of that day in the **device's own time zone**. On the learner's devices, set to WIB, that's 08:00 WIB. A device in another time zone would ring at 08:00 its local time. For this single-user POC that's the intended behavior.
- **Unverified, test during the build** (learner request):
  - Opening the file in Outlook on the learner's laptop (for the demo; confirmed by the learner that `.ics` opens there). Verify that the all-day event, the description, and the alarm appear.
  - The learner's Android phone with Google Calendar or another calendar app. Google Calendar is known to often ignore `VALARM` from imported files and use its own default reminder, and Android may not open `.ics` directly.
  - Any problem found is written in `README.md > Known limitations`, not worked around with extra features.
- **Device test results (learner, 2 Oct 2026):**
  - New Outlook for Windows: imports through Add calendar > Upload from file; title, note and date are right. Without the two `X-MICROSOFT-CDO-*` lines it showed the event as 07:00 to 07:00 the next day (shifted by the UTC+7 offset); with them it shows "All day" on its own day. These are two standard header lines in the same file, not an extra feature. Reminder: not confirmed yet.
  - Google Calendar on Android: opens the file sent over WhatsApp, right all-day date, title and note. It replaces the 08:00 alarm with its own default (17:00 the day before) and shows the event as busy. README limitation.

### The VCR font file
Stored in `assets/fonts/` with its license. Loaded with `@font-face` in `base.css` from a relative path. No Google Fonts or CDN requests, so the app works offline once loaded.

## Important Failure Modes
- **Saved data is missing or corrupted** (someone cleared the browser, or the JSON is broken) → `loadTapes()` returns an empty list and the shelf shows "Record your first tape". The app never crashes on bad data.
- **The calendar app doesn't import the alarm or can't open the file** → the tape is still saved and the app is unaffected. The limitation is written in the README (learner decision).
- **Wrong "today" around midnight or time zones** → all dates are compared as local `YYYY-MM-DD` strings from `todayLocal()`, never UTC, so a tape due today is READY in WIB at any hour.
- **The font file fails to load** → the CSS font stack falls back to the system monospace, so the app looks plainer but works.

## What Was Simplified and Why
- **CSS overlay effects** instead of a WebGL shader pipeline (learner choice). WebGL can't post-process HTML, so the full version would mean redrawing the whole UI in a canvas. Tradeoff: no curved distortion, accepted as fine for a nostalgic tone.
- **localStorage in one browser** instead of accounts or a database. Accounts and sync are deferred (`prd.md > Deferred From the POC`). The fuller version would need a server, logins, and a hosted database.
- **A downloaded .ics file** instead of in-app or push notifications. Push would need a server and permissions. The calendar already delivers the reminder, with the first step in it.
- **No in-app delete or reset.** Rehearsing the demo from empty is done by clearing localStorage in DevTools, documented in the README. Delete is deferred in the PRD.
- **Hand-written screen switching** instead of a framework (learner choice). This is enough for 7 screens, and the learner learns the basics.

## Decisions and Open Issues

### Learner decisions
- **Understand basic web code, only what Pause Tape uses, explained by comparison with Unity/C#.** From the learner's learning goal: a future NO SIGNAL website.
- **Static site on GitHub Pages**, free, so judges can open a link. Build and recording happen locally; deploy happens in `6-ship`.
- **Everything in the browser:** tapes in localStorage (like PlayerPrefs), `.ics` created in the browser, VCR font stored in the project.
- **HTML/CSS/JS with no framework.**
- **VHS effect as a CSS layer driven by `--vhs`**, mirroring `VHSDriver`. Curved distortion isn't needed ("nostalgic, not scary").
- **Revised during `5-build`, after the first hands-on checkpoint: a three.js shader layer now, a full shader-rendered Playback screen in the final review.** The learner tried slices 1–2 and found the look "still too plain", pointing to shader.se as the reference. Of three options (a shader overlay only; Playback fully rendered through a shader; the overlay now and the full version during polish), the learner chose the third: "I want the playback screen to feel like shader.se, but the app has to stay whole and submittable at any time." The overlay is a click-through three.js canvas (grain, rolling tracking band, chroma fringe, scanlines, vignette, glass glare) whose strength follows `--vhs`; the CSS layer stays as the fallback when WebGL isn't available. GSAP's ScrambleText makes each answer "tune in". React, ScrollTrigger, and Lottie are not used in Pause Tape (learner decision); those skills are kept for the future NO SIGNAL website.
- **CSS confirmed over WebGL at the start of `5-build`** (superseded by the revision above). The learner asked whether the app could switch to WebGL for 3D, since 27 days remain. Three options were weighed: keep CSS, a hybrid WebGL shader on the Playback screen only, or a full 3D scene. The learner chose to keep CSS, so the stack and effect approach above are unchanged.
- **Flicker slow and soft, never fast blinking; with reduced motion, flicker and glitch off, scanlines stay.** Learner addition.
- **Demo shows the `.ics` opening in Outlook on the laptop**, so it's all in one screen recording. Test the Android phone too, and document any alarm or file-opening problem in the README as a limitation.
- **Screen change = a short freeze, then a tape glitch (learner request, 2 Oct 2026: "bukan squeeze in tetapi efek glitch dan freeze sebentar karena tv tabung bukan seperti squeeze")**: on every screen change (REC, BACK, STOP, and the rest) the old screen holds still for about 0.14 s, like a paused tape, then tears away in sideways-shifted bands with a red/blue split while the new screen shows through, and the new screen jitters once as it locks on (about 0.35 s in all). The frozen picture is an inert copy of the old screen laid over the new one, so the new screen's buttons work at once. Replaces the earlier vertical squeeze, which no CRT of the time did. Reduced motion: a plain cut.
- **How the room runs in the app (built 2 Oct 2026)**: `js/room.js` holds the room (ported from the approved mockup) and is loaded by `js/app.js` only when WebGL works and the window is at least 700 px wide; `?flat` forces the flat TV, and a phone keeps it, so the app never depends on the room. The app's `.tv__screen` moves onto the 3D TV's glass through a `CSS3DObject` (a fixed 880 x 660 CSS-pixel screen scaled to the glass, like a world-space Canvas) under a transparent WebGL canvas that takes no clicks; the glass is drawn as a hole (`NoBlending`, alpha 0) so the HTML shows through, and the room's own clicks are picked by a raycast on the stage. TV modes: standby (the room; the TV shows PRESS THE VCR) → app (VCR or TV clicked: the camera moves into the full zoom, then the app becomes live; until then it is `inert`) → insert (a tape played: the camera backs out, the cassette slides in) → loading (the app's own blue screen, `PACE.blueMs` 3000 in the room) → play (the camera eases in when Playback starts). BACK TO THE ROOM or Escape returns to standby and the app to the shelf. Full zoom is worked out per window so the whole glass fits with a bezel band above and a wider one below for the button. The sun shafts and the glass reflection fade out in the TV.
- **Typing inside the room (learner choice, 2 Oct 2026: "zoom penuh ke TV, sehingga form terbaca jelas")**: on the Record screen and every other screen with a form, the camera sits in the full TV zoom of the mockup's play pose, so the app screen fills nearly the whole view; the room is only seen when the player steps back to it.
- **App screen inside the TV (learner choice A, 2 Oct 2026): `CSS3DRenderer`** from the vendored three@0.186.1 (`examples/jsm/renderers/CSS3DRenderer.js`, same MIT licence, no new library). The real app DOM is placed on the TV glass in 3D, so it shrinks and grows with the camera and stays typeable. CRT curve on the live form (learner choice "1 dan 2", 2 Oct 2026): a thin SVG `feDisplacementMap` barrel filter on the app screen on laptops and desktops (spike: the real form bends and stays typeable); a CSS-only illusion (rounded corners, darker edges, curved glass glare, the VHS lines) on Safari, touch screens and reduced motion, or if the filter breaks inside `CSS3DRenderer`; screens without a form (PLAY, loading) keep the full shader.
- **A room around the TV, added during `5-build` for the final review, then revised** (see `prd.md > Look and Feel`): a real three.js room instead of flat layers (learner choice: "B, a real 3D room"); the camera turns slightly with the cursor; the objects are simple shapes made in code and AI art is used only for the window view (learner choice: "mixed"); light follows the visitor's local time in four periods, with `?time=` for the demo; the TV starts on a standby screen and the clickable VCR opens the shelf. After the learner marked up a screenshot (orange = light source, yellow = light direction, red cross = remove, green box = where the photo goes), the side table and can were removed, the visible sun, the light shafts and the real light share one direction. The learner then found the left side too empty and the outside too realistic for a cartoon room, so the room was redone: a bookshelf with a sofa in front of it, the cabinet moved to the middle with the frame at one end and a lamp at the other, a curtain that opens and closes on a click, a lamp that switches on and off on a click, and a photo frame that takes the player's own picture (cropped to the frame, shrunk, stored in localStorage, never uploaded; one more localStorage key beside the tapes). Third round (learner markup): the sofa stands out from the shelf and is turned toward the TV, an armchair on the right and a table with books and papers in the middle; the curtain became moving cloth (vertices reshaped every frame); the lamp got a spring pull cord (drag or click); the photo got a PHOTO panel (preview, drag to move, ZOOM slider and wheel; stored as `pausetape.photo.v2` = `{ src, zoom, x, y }`, the v1 picture is migrated); and playing a READY tape runs insert (camera back, cassette into the VCR) → loading (about 3 s, the app's 20-block bar) → play (the camera eases in to the screen). Fourth round: the plant became a grandfather clock modelled in code after the learner's photo, three Seedream paintings hang on the empty walls (`assets/room/painting-*.jpg`), and the seats became a side sofa and an armchair facing each other plus a long low sofa facing the TV, with a walkway and nothing in front of the photo frame. Fifth round, the learner's written layout spec (positions, rotations, scale, floor material and camera only; look, light and interactions unchanged): room 5.0 x 3.6 x 2.6 m with the TV wall at z -1.8; bookshelf (-1.95, -1.66) 0.9 x 0.25 x 1.9; window centred at x 0.1, 1.2 wide; cabinet (0.1, -1.63) 1.6 x 0.35 x 0.55 with the TV at x 0.1, the VCR at x 0.68 and the photo frame left of the TV; lamp on a small side table at (1.18, -1.6); clock (2.25, -1.6) 0.4 x 0.4 x 2.0; rug (0, 0.17) 2.5 x 1.95; coffee table (0, 0.18) 0.8 x 0.45 x 0.4; main sofa (0, 1.33) 1.8 x 0.75 facing the TV; small sofa (-1.98, 0.3) 0.75 x 1.2 facing +x; armchair (1.85, 0.22) 0.7 x 0.75 facing -x; seat 0.42 m, back 0.85 m; one wood floor; left painting on the left wall at 1.5 m over the small sofa; camera (0, 1.5, 2.6) looking at (0, 0.9, -1.6), FOV 45. The night window picture is now made from the day picture with a small image script, because the gateway drops reference images and two generated pictures never matched. It is designed first in `devpost/room-mockup.html` (the learner has no paid Figma plan, so the mockup replaces a Figma design) and only then built into the app. Window art (revised twice at the learner's request, the second time to a semi-cartoon street seen side-on across the road): Codex can't generate images here (its CLI is signed in with a non-OpenAI API key, and OpenAI's Codex pricing page lists image generation as not available on the Free plan). The learner asked for Grok or BytePlus Seedream instead, so the two window pictures (`assets/room/window-day.jpg`, `window-night.jpg`) were generated with Seedream 5.0 pro (`dola-seedream-5-0-pro-260628`) through the OpenAI-compatible API gateway the learner already uses: 2304×1728 (4:3), visible watermark switched off, no text or logos in the prompt. The gateway ignores reference images, so both pictures come from one shared written description of the street. The files keep the C2PA content credentials BytePlus embeds; never strip them. BytePlus's General Terms for AI Services (section 2.1) say the customer owns the Output and BytePlus claims no ownership; the gateway's own terms weren't found. The README credits the model.

### Implementation details derived from those (AI defaults, accepted by the learner in review)
- JS modules, served locally with `python -m http.server 8000` (learner confirmed Python 3.11 is installed).
- System monospace for answers. (The OSD font, VT323, is a learner decision.)
- Minutes are rounded to the nearest minute, minimum 1.
- Playback pacing: blue screen about 1.2 s, about 2.5 s between answers, "NO SIGNAL" about 1.2 s. Tuned by feel during the build.
- `--vhs` values per screen: 0.3 record, 0.5 shelf and results, 1.0 playback.
- The app sits at the repo root.
- Record Screen details from the first build step, accepted by the learner: the chosen date echoed in VCR format beside its label (the date picker's own format is ambiguous), a BACK button that returns to the shelf and keeps the typing, the four questions in two columns so they fit one screen, the TV sized to the window's height, the ● ■ ▶ symbols drawn in CSS (VT323 has no glyphs for them), and the REC dot's blink turned off with reduced motion.

### The useful unknown
**"How is the VHS effect made on the web, and is it like a shader in Unity?"** Clarified in conversation. A real web shader (WebGL) exists but can only process what it draws itself, not HTML text and buttons, unlike a URP fullscreen pass that processes the whole camera image. So the effect becomes a click-through CSS overlay plus per-answer glitch animation, with one intensity variable set from JS, the same control pattern as `VHSDriver`. **Checked during the build:** on the first effects step, compare the Record Screen (`--vhs` 0.3) and Playback (`--vhs` 1.0) side by side and confirm the difference is visible, as `prd.md > Playback` requires ("Scanlines/effects are visibly stronger here than on the Record Screen").

### Open issues to resolve early in the build
- **Outlook:** confirm the all-day event, description, and alarm appear when the `.ics` is opened.
- **Android phone:** test the file and alarm, and record findings in the README.
- Carried from `prd.md > Open Questions`: none.
