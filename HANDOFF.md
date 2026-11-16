# Gossamer: handoff brief for the next AI session

You are picking up **Gossamer**, a hands-first mixed-reality game for Meta Quest, built for the **Meta VR Start Developer Competition 2026**. Read this first, then `SUBMISSION.md` and `README.md`.

## The competition (read carefully: real prize money)
- Page and rules: https://start-developer-competition-26.devpost.com (rules: https://start-developer-competition-26.devpost.com/rules)
- **Deadline: Wednesday 18 November 2026, 12:00 PM PST (21:00 Danish time).** No changes are allowed after it. Aim to submit the evening before.
- **Entry:** Gaming track, **New Experience** division. This category requires the project to be conceived and built inside the window that began 24 Sep 2026. The repo history starts 6 Nov 2026. Do **not** copy code or assets from other repos (especially `nxt-thing-hand` / *die Hände*).
- **Hard requirement: hands-first.** The whole experience must be playable with hands only, with no controller ever paired.
- **Guidelines:**
  - Seated, with every interaction within a 2 ft radius.
  - Fast cold start and clean pause/resume, with a satisfying moment in 10 minutes or less.
  - Original work, not a wrapper around another service.
- **Judging** (25% each):
  - **Innovation:** use of passthrough, hands, scene understanding and persistent anchors.
  - **Experience Design:** intuitive onboarding without walls of text, and passthrough that matters (the real room must change the experience).
  - **Technical:** at least 60 fps on Quest, bug-free, hand tracking, passthrough, anchoring to room planes, field-of-view-aware layout.
  - **Polish & Presentation:** art direction, sound, UI, and the submission materials.
- **Submission:**
  - Public link to the playable build (GitHub Pages is fine for IWSDK/WebXR).
  - Demo video under 3 minutes: real gameplay recorded on a device, not AI-generated video.
  - Devpost form: 140-character tagline, ~500-word description, hand interactions, target launch date.
- **Side awards we target:** Best First Five Minutes, Best Reason to Come Back ($25k each).

## Where it is
- Code: `/Users/midwifevr/Documents/GitHub/nxt-spider-web` (git, branch `main`)
- GitHub: https://github.com/MoHaulik/nxt-spider-web (public)
- Live build: **https://mohaulik.github.io/nxt-spider-web/**. Open it in the Quest browser. Add `?fresh` for a new web, `?fast` for quick pacing, `?rain`, `?hour=7` for morning dew.
- Deploy: `npm run deploy` (builds and pushes the `gh-pages` branch).
- Dev: `npm run dev` (HTTPS on the LAN, with the IWER emulator on localhost). Run `npx tsc --noEmit` before testing.
- Desktop preview keys: `f` fly, `r` rain, `n` next beat, `e` eggs, `h` hatch.

## What it is
A spider descends from your real ceiling on a single thread.
- **Steering:** you point (a ray from your shoulder through your hand) and it goes there.
- **Spinning:** a tap of the fingers starts a thread, and the next tap ties it off. Threads crossing the middle become radii through a hub, and the spider lays the sticky spiral itself.
- **Silk:** a resource, refilled by meals.
- **Prey:** flies, moths and gnats are caught by the web. Touching one with the spider eats it.
- **Eggs:** a visible nest fills with each meal, then the spider lays an egg sac. It hatches when the sun returns after rain. Spiderlings balloon to real surfaces (found through WebXR plane detection) and build small webs that persist and grow between sessions.
- **The room:** frame lines tie to the real floor, walls and ceiling. Real time of day sets the light (dew in the morning).
- **Sound:** everything is procedural and synthesized, including a generative score.

Stack: IWSDK 1.1.0-rc.2 (three.js r185), TypeScript, Vite. Code is in `src/game/`; all tuning is in `src/game/config.ts`.

## Art direction rules from the owner (Morten)
- **No text or UI in the world, ever.** It's art, like Limbo.
- The landing page is the title, one chapter line ("Build a home." / "Maintain a web." / "Grow a family." / "Let them go." / "Fill the room.") and "enter".
- The spider must never look like a tick: long banded legs, a dark glossy two-part body.
- No line from the hand to the spider.
- The bar is Steve Jobs-level attention to interaction detail.

## Status and next steps
- **Latest playtest feedback:** hard to control, unclear when you can spin, needs purpose, gets boring. The latest build addresses all four, but it **has not yet been tested on a headset**. Get feedback from the owner first.
- **Remaining:**
  - Verify on Quest 3 at 60 fps or better.
  - Record the gameplay video under 3 minutes (shot list in `SUBMISSION.md`).
  - Fill in the Devpost form from `SUBMISSION.md`, including the [bracketed] items.
  - Submit before the deadline.
