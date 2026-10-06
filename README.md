# Pause Tape

**Pause a side project cleanly: record a "tape" to your future self when you stop, and play it back when you come back, so you know exactly what to do next.**

▶ **Try it:** https://fairolegends.github.io/pause-tape/ (no install, no account)

Pause Tape is a small web app that looks and feels like an old CRT TV with a VCR. When you have to put a project on hold, you press **● REC** and answer four short questions: where you stopped, the first small step when you come back, what you're still unsure about, and why the project matters to you. You can add a voice note too. You pick a return date and can download a calendar reminder for it. The note is saved as a tape on your shelf.

When the date comes, the tape turns **READY**. Press ▶ and it plays back like an old cassette: a blue VCR screen, "MESSAGE FROM [date] · [N] DAYS AGO", your answers one by one, and finally your first step with a **10-minute timer**. Press **I'm back on it** and the app records how many minutes it took you to actually start again.

It's for anyone with a side project they've had to pause. The first real user is me: I'm freezing my horror game *NO SIGNAL* until January 2027 for this hackathon, and I want to know exactly where to start when I return.

Built for the Devpost **Build With AI: Basics** hackathon. The planning documents are in [`devpost/`](devpost/): [scope](devpost/scope.md), [PRD](devpost/prd.md), [spec](devpost/spec.md) and the [build checklist](devpost/checklist.md).

## Try it in 1 minute

1. Open the link above on a laptop (Chrome or Edge works best).
2. Click the **VCR** under the TV. The camera moves into the TV and the tape shelf opens.
3. There's a **SAMPLE** tape called "Pause Tape", already READY. Click it to watch a full playback, then press **I'm back on it**.
4. Press **● REC** to record your own tape. Only the project name, the return date and the first step are required.
5. The room's sounds (rain, the clock, the season outside, the VCR) start with your first click. **MUSIC OFF** in the top-left corner turns the lo-fi music on; **SOUND** in ROOM CONTROLS mutes everything.

On a phone or tablet the 3D room works by touch, in a lighter mode so it stays smooth: still furniture is merged into fewer draws, it runs at 30 fps with a resolution that drops when the phone struggles, and it has less dust, rain and shadow detail. Tap the VCR, the curtain, the lamp or the photo. It is most comfortable with the phone turned sideways.

## What's in it

- **Tape shelf:** your tapes as VHS cassettes. Locked tapes show a countdown, but can be played early after a confirmation; READY tapes glow green; finished tapes show "BACK ON IT · N MIN". Above the shelf: your average BACK ON IT time.
- **Record screen:** a camcorder viewfinder with a running REC clock, the four questions, an optional voice note (up to 40 seconds), and the return date.
- **Calendar reminder:** "Add to calendar (.ics)" downloads an all-day event for the return date, with a reminder at 08:00 and your first step in the notes.
- **Playback:** blue VCR loading screen, the "MESSAGE FROM …" intro, your voice note, answers revealed one by one with a tape glitch ("NO SIGNAL" for empty ones), ▶▶ to skip, then the first step and the 10-minute timer.
- **PAUSE AGAIN:** from the BACK ON IT screen, record the next tape for the same project.
- **Erase, backup, restore:** ⏏ on a tape erases it (after a confirmation). BACKUP downloads your tapes as a `.json` file, and RESTORE adds them back from one.
- **The room** (laptops and desktops): a 3D living room around the TV. The light follows the time of day, the window view changes with the season (snow, spring, summer, dry season), and the books on the shelf are arranged anew at every visit. By day a breeze moves the trees outside; on calm nights outside winter, fireflies drift over the gardens; in the rain, water runs down the glass. Simon, a sleeping cat, lies on the floor in a new pose at every visit, and shows his name when you point at him. You can open and close the curtain, pull the lamp's cord, put your own photo in the frame, and watch the cassette go in and come out of the VCR. **ROOM CONTROLS** (top right) lets you change the time of day and the season, turn rain on, and switch on REDUCE MOTION or HIGH CONTRAST. **HOW IT WORKS** lists the AI model and the prompts behind the pictures.
- **Sound** (off until you turn it on): rain, a ticking clock, quiet lo-fi, outdoor sounds that follow the season, the time of day and the curtain, and VCR, tape and TV effects. Made in code with the Web Audio API, except the rain, which is a recording (see Credits).

## Where your data lives

Everything stays in **your browser on this device**. There's no account and no server.

- Tapes, settings and your photo are kept in `localStorage`, and voice notes in IndexedDB.
- Another browser or another device starts with an empty shelf. Use **BACKUP** and **RESTORE** to move your tapes (photos and voice notes aren't included in the backup file).
- Clearing your browser's site data erases your tapes.

## Run it locally

You need Python 3 (or any static file server). Nothing to install or build.

```bash
git clone https://github.com/FairoLegends/pause-tape.git
cd pause-tape
python -m http.server 8000
```

Then open http://localhost:8000.

Useful addresses for testing and demos:

| Address | What it does |
|---|---|
| `http://localhost:8000/?time=pagi` (or `siang`, `sore`, `malam`, or `morning` / `day` / `afternoon` / `night`) | Fixes the time of day in the room |
| `http://localhost:8000/?season=snow` (or `spring`, `summer`, `dry`) | Fixes the season outside the window |
| `http://localhost:8000/?flat` | The flat TV without the 3D room |
| `http://localhost:8000/?books=18` (any number or word) | Fixes the arrangement of the books on the shelf. Without it, every visit gets a new one |
| `http://localhost:8000/?cat=7` (any number or word), and `&pose=sploot` (`curled`, `loaf`, `side`, `back`, `sploot`, `croissant`, `sphinx`, or a number 0-6) | Fixes Simon the cat's coat and pose. Without them, every visit gets a new cat |

**Reset for a demo from an empty shelf:** open DevTools (F12) → Application → Local Storage → `http://localhost:8000`, and delete the keys that start with `pausetape.`. The sample tape comes back once the shelf is empty again.

## Known limitations

- **Calendar apps change the reminder.** I tested the `.ics` file on my own devices:
  - **Outlook for Windows** (the new app) imports it as an all-day event marked Free, with the first step in the notes. Before I added Outlook's own all-day lines to the file, it showed the event shifted by 7 hours (the WIB offset), from 07:00 to 07:00 the next day.
  - **Google Calendar on Android** imports the right date as all day, with the note. But it replaces the file's 08:00 reminder with its own default for all-day events (17:00 the day before), and marks the event Busy instead of Free. That's Google Calendar's behaviour with imported files, and a web page can't change it.
- **The ▶ in the event title** shows as an emoji (▶️) in Google Calendar.
- **The 3D room needs WebGL** and a screen at least 560 × 300 px. Without those you get the flat TV, which has every feature except the room. On phones it runs in a lighter mode; I tested it with Edge's phone emulation and on my own phone, not on many devices.
- **Voice notes need a microphone** and a page served over `https` or `localhost`. The browser asks for permission the first time. If there's no microphone, or access is refused, the tape works without a voice note.
- **The seasons' pictures** were generated separately, so the houses across the street sit a little differently in each season.
- **Browsers:** checked in Microsoft Edge on Windows (and phone sizes, portrait and landscape, by touch emulation). Safari isn't tested; it gets a simpler CRT curve (CSS instead of the SVG filter).

## How it's built

Plain HTML, CSS and JavaScript modules: no framework, no build step, no backend. It's hosted on GitHub Pages.

- `index.html`: every screen as a `<section data-screen>`.
- `js/app.js`: the screen switcher.
- `js/store.js`: storage.
- `js/tapes.js`: date and tape rules.
- `js/shelf.js`, `js/record.js` and `js/playback.js`: the shelf, the Record screen and Playback.
- `js/ics.js`: the calendar file.
- `js/voice.js`: voice notes.
- `js/sound.js`: all audio.
- `js/prefs.js`: accessibility switches.
- `js/crt.js`: the VHS shader layer.
- `js/room.js`: the three.js room, where the real app screen sits on the 3D TV's glass with `CSS3DRenderer`.
- `js/books.js`: places the books on the bookshelf, a new arrangement at every visit (a leaning book always rests on a neighbour).
- `js/cat.js`: builds Simon, the sleeping cat, from a seed (six poses picked at random, a seventh with `?pose=back`).
- `js/ambience.js`: the sounds of the view outside the window (birds, insects, wind, rain), one scene for each season and time of day.
- Libraries are vendored in `assets/vendor/`: three.js r186 and GSAP 3.15 (text scramble and timing).

## Credits

- **AI-generated pictures:** the window views and the two paintings were generated with **Seedream 5.0 pro** (`dola-seedream-5-0-pro-260628`, by BytePlus), reached through an OpenAI-compatible API gateway, with no people, logos, text or watermarks. The night views were made from the day pictures with a small image script. The `.jpg` originals keep their C2PA content credentials.
- **Font:** [VT323](https://github.com/google/fonts/tree/main/ofl/vt323) by Peter Hull, SIL Open Font License 1.1 (`assets/fonts/OFL.txt`).
- **Libraries:** [three.js](https://threejs.org/) (MIT) and [GSAP](https://gsap.com/) (GSAP standard no-charge license).
- **Sound:** the room's sounds are generated in code (Web Audio API). The one exception is the rain: `assets/audio/rain-window.mp3` is a 60-second loop cut from **"Rain (on the window)" by DonRain** on [Pixabay](https://pixabay.com/sound-effects/nature-rain-on-the-window-114709/), used under the [Pixabay Content License](https://pixabay.com/service/license-summary/). If the file cannot load, the app falls back to rain made in code.
- **Built with AI coding agents** (Claude Code and Hermes Agent), following the Devpost Learn skill pack (`agent/skills/`).

Full list with the license of every bundled file: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT, see [`LICENSE`](LICENSE). Bundled third-party files keep their own licenses.
