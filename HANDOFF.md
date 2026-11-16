# Gossamer: handoff brief for the next AI session

You are picking up **Gossamer**, a hands-first mixed-reality game for Meta Quest, built for the **Meta VR Start Developer Competition 2026**. Read this first, then `SUBMISSION.md` and `README.md`.

## The competition (read carefully: real prize money)
- Page and rules: https://start-developer-competition-26.devpost.com (rules: https://start-developer-competition-26.devpost.com/rules)
- **Deadline: Wednesday 18 November 2026, 12:00 PM PST (21:00 Danish time).** No changes are allowed after it. Aim to submit the evening before.
- **Entry:** Gaming track, **New Experience** division. This category requires the project to be conceived and built inside the window that began 24 Sep 2026. The repo history starts 6 Nov 2026. Do **not** copy code or assets from other repos (especially `nxt-thing-hand` / *die Hände*).
- **One entry per person.** The official rules (section "Entry Limit") allow each individual exactly one Entry, whether solo or as a team representative. A second game can only be entered by a different person (or a team with a different representative). Being a non-representative member of other teams is allowed.
- **Stage one is pass/fail** (fits the theme, uses hands, passthrough, scene understanding); stage two is the four 25% criteria below. Entries must stay available and unchanged until the winner announcement (around 11 Dec 2026).
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
A spider descends from your real ceiling on a single thread, small, and grows as it eats. The session is a story with a curve:
1. **The scaffold (intro).** Swing the spider with your hand, side to side. Where it swings out toward an untied side (a real wall, the floor, furniture, the ceiling it came from), it runs a mooring line there and back. A glint on the real surface shows the next one; the spider looks that way. When every side is tied the ring closes. Moorings (`MOOR`) never decay and the bird never cuts them.
2. **Spinning.** A tap of the fingers starts a thread, the next tap ties it off (holding the pinch works too). Threads across the middle become radii through a hub. The sticky spiral is laid a turn at a time **only where the spider is** (`CFG.rungReach`), so the player sweeps the spider round the web; with the hand at rest the spider goes round by itself.
3. **Flies, meals, growth.** Size goes from `CFG.sizeMin` (0.6) to `CFG.sizeMax` (2.1) with food.
4. **Rain** (after `rainAfter` meals or `rainLatest` seconds): the new rain has depth (instanced ribbon drops with bright heads, falling around and in front of the player, splashing on the floor). Heavy drops gather on the ceiling, swell for `dropGather` seconds and fall: a thread hit tears, a spider hit knocks it down its dragline (`knock`). Sun afterwards: a feast of flies, and the wet web to repair.
5. **The bird** (after `birdAfter` meals, then every `birdGap`): two calls from one side, the spider freezes (`spider.alarm`), the bird glides through the web plane and tears what it crosses. Safe if still, at the frame edge, or with the hand lowered; otherwise knocked down.
6. **Eggs** (only once a bird has passed): the nest fills with meals, a sac is spun, and each following meal is carried to the sac (`carry`, `brood.feed`). Fed (`CFG.sacMeals`) and warmed by sun after rain, it hatches; spiderlings balloon to real surfaces (plane detection) and build small webs that persist.
- **Steering:** a ray from your shoulder through your hand. **No line from the hand to the spider.**
- **The room:** moorings tie to the real floor, walls and ceiling. Real time of day sets the light.
- **Sound:** everything is procedural, including the bird's call, its wings, the thud, and a generative score.

Stack: IWSDK 1.1.0-rc.2 (three.js r185), TypeScript, Vite. Code is in `src/game/`; all tuning is in `src/game/config.ts`.

## Art direction rules from the owner (Morten)
- **No text or UI in the world, ever.** It's art, like Limbo.
- The landing page is the title, one chapter line ("Build a home." / "Maintain a web." / "Grow a family." / "Let them go." / "Fill the room.") and "enter".
- The spider must never look like a tick: long banded legs, a clear two-part body.
- The spider must not look scary either: think a Pixar house spider, still realistic. Warm velvety brown, rounded, small eyes (no big cartoon eyes), no fangs, no hair, no spike, slow unhurried motion. It starts small and grows.
- Things should happen: a curve of events (build, eat, rain, dodge drops, sun, repair, feast, bird, eggs), not everything at once. Babies come late.
- The player must feel they make the web themselves (the spider does craft, the player does the choosing and the sweeping).
- No line from the hand to the spider.
- The bar is Steve Jobs-level attention to interaction detail.

## Status and next steps
- **16 Nov 2026 (this session):** rebuilt around the owner's feedback: friendlier, smaller-then-growing spider; the swing-to-scaffold intro; the spiral laid where the spider is; rain with depth and heavy drops to dodge; the bird; eggs moved to the end of the arc and fed by meals. Verified in the desktop preview (`?desktop&fast&fresh`), typechecked and built. **Not yet tested on a headset.** Merged into `main` and deployed to GitHub Pages (commit 083198b).
- **Remaining:**
  - Headset test on Quest 3: the swing-to-scaffold feel (trigger radius `frameR * 0.72`, angular window 0.55 rad in `frameStep`), the spiral reach, the heavy-drop dodge, the bird's hit box (0.11) and whether the "hold still" rule reads. Verify 60 fps or better (the rain is now 700 instanced quads; `Rain.N`).
  - Record the gameplay video under 3 minutes (shot list in `SUBMISSION.md`).
  - Fill in the Devpost form from `SUBMISSION.md`, including the [bracketed] items.
  - Submit before the deadline (aim for the evening of 17 Nov).
