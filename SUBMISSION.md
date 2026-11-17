# Gossamer: submission draft

Draft for the Devpost form (Meta VR Start Developer Competition 2026). Edit freely; the numbers in brackets are things to fill in after device testing.

**Project name:** Gossamer

**Tagline (135 / 140):**
A small spider descends into your real room. Swing it to tie a web to your walls, feed it, weather rain and a bird, and raise its brood.

**Track:** Gaming
**Division:** New Experience (conceived and built from 6 November 2026; the repository history starts that day)

**Playable link:** [GitHub Pages URL]
**Video:** [YouTube/Vimeo, under 3 minutes, recorded on Quest 3]

---

## Description (~500 words)

**Inspiration.** Everyone has watched a spider come down on a single thread and stopped what they were doing. We wanted that moment in mixed reality, and we wanted it treated like cinema, not a toy. Gossamer has no words, no menus and no score on screen. Your room dims, something glints at your ceiling, and a spider lowers itself, perfectly straight, until it hangs at arm's length in front of you. Then it is yours.

**How it plays.** The spider arrives small. Swing it with your hand, side to side, and where it swings out toward a real wall, the floor or your sofa it runs a line there and comes back: the scaffold, tied to your room, which nothing ever breaks. When every side is tied the ring closes and it is yours to build on. Tap your fingers together and it starts a thread; swing, tap again, and the silk ties off, pulled taut. Swing a thread across the middle and the spider lays it as two true radii through a hub. The sticky spiral it lays a turn at a time, only where it is, so you sweep it round the web and the spiral follows, the way orb-weavers really build. You choose the architecture and the spider does the craft. Silk is not free: it can only spin what it has eaten for, and you see its reserve in how plump it is. You don't chase flies. The web catches them. A caught fly shakes the whole web and tears at the silk, so there is a reason to hurry: touch it with the spider and it is taken at once, bound and eaten while you carry on. With every meal it grows, from a spiderling to a full garden spider, and spins thicker silk. Then the story turns. Rain comes, with real depth, falling around you and between you and the web. Drops gather on your ceiling, swell, and let go: one on a thread tears it, one on the spider knocks it down its dragline, so you dodge. When the sun comes back the web is beaded with dew, every drop a tiny lens, and the flies feast. Then a bird calls from one side of the room. The spider hears it before you do and freezes. Hold still, or sit at the edge of the frame, and the bird glides through, tearing what it crosses. Move in the open and you are knocked down. Only after all that, eggs.

**Your room matters.** Gossamer reads the room the headset has scanned. The dragline hangs from your actual ceiling, and the scaffold ties off to your real floor, walls, tables and sofa, so every room gives a different web and a different swing. At the top of the frame the spider keeps a small silk nest, and every meal makes it denser and warmer, so you can always see what you are working toward. When it is full, the spider is heavy with eggs and spins a sac there, and carries the next meals to it. The sac waits for food and warmth: when the sun comes back after rain, it trembles and opens, and a ball of spiderlings balloons out on silk to real surfaces around you (wall corners, the edge of a shelf, under a table). A few families settle and build their own small webs there, and they catch the flies that slip past yours. The web stays anchored where you left it. While you are away the spider lives on: it wraps the flies it catches and stores them in the web for you, and its families grow. Come back tomorrow and your room has a little more silk in it. Gossamer also keeps your real time of day: mornings the web is beaded with dew and lit gold, evenings are amber, nights are cool moonlight.

**How we built it.** WebXR on Meta's Immersive Web SDK (IWSDK) with three.js, hosted on GitHub Pages. Everything is procedural and original: the spider, flies, the bird, silk, rain, dew, sound. The web is a position-based (Verlet) simulation of several thousand silk particles with rope constraints, sag from loss of health, and snapping. Silk renders as one camera-facing ribbon mesh with an anisotropic highlight and a diffraction-style spectral band. Dew renders as instanced ball-lens impostors with per-channel refraction. Room integration uses WebXR plane detection and persistent anchors. Real hands stand in front of the web through depth-only hand occluders. All audio is synthesized and tuned to a pentatonic scale, so plucking the web plays it. A generative felt-piano score is made of the ecosystem itself: sparse while the web is young, fuller as it grows, darker in rain, brighter when the sun returns. The landing page says one line, your chapter of the story: Build a home. Maintain a web. Grow a family. Let them go. Fill the room.

**What's next.** More species with different web architectures, seasons and morning dew tied to your local time, and shared rooms where two people's spiders build together. Target launch: [month 2027] on the Meta Horizon Store as a free web app.

---

## Hand interactions (for the form)

- **Point to steer:** raise your hand and point; the spider goes where you point on the web, like the system pointer. Works seated with small movements.
- **Swing to tie the scaffold:** at the start, swing the spider out toward a wall, the floor or furniture and it runs a mooring there and back.
- **Sweep to lay the spiral:** the sticky spiral is laid only where the spider is; bring it round the web.
- **Dodge and freeze:** move the spider out from under a falling drop; hold your hand still (or lower it) when the bird calls.
- **Tap your fingers:** silk begins at the spider. Swing, then tap again to tie it off. Holding the pinch works too. Either hand can tap while the other steers.
- **Touch a caught fly with the spider:** it's taken at once, bound and eaten while you carry on.
- **Lower your hand:** the spider goes about its own business. It fetches caught prey and goes to its nest to lay.
- **Pluck a thread with your fingertip:** it rings and sways.
- No controller, no menus, no words in the world. The first time it's needed, a soft cue at your fingertips shows the pinch.

## Judging checklist

- Hands-first end to end. Controllers optional (trigger = pinch).
- Seated: every interaction within a two-foot radius. The web sits in the central field of view.
- Fast cold start. Pause on the system menu, autosave, resume where you left off.
- The first complete moment (first fly caught and eaten) arrives within about 4 minutes; the first rain and the bird within ten.
- Passthrough is purposeful: ceiling, floor, walls and furniture hold the web and the colonies.
- Persistent anchors keep the web in place between sessions.
- Performance target: 72 fps on Quest 3. [confirm on device]

## Video plan (under 3 minutes, captured on Quest 3)

Lead with the hook, then the story. Judges may stop at any time.

1. **0:00–0:06 (hook):** the finished web in your real living room, beaded with dew, and the bird tearing straight through it. One shot, no title.
2. **0:06–0:25:** the room dims, the ceiling glint, the small spider's descent. No cuts.
3. **0:25–0:50:** the hand swings the spider side to side; lines run out to the real wall, the sofa, the floor; the ring closes.
4. **0:50–1:15:** first threads; the spider sweeps round and the spiral follows; a fly arrives by sound, gets caught, the slow-motion meal, the spider grows.
5. **1:15–1:50:** rain with depth. A drop gathers on the ceiling and falls; the spider dodges (or is knocked down). The sun comes back onto the wet web; the feast.
6. **1:50–2:15:** the bird calls; the spider freezes; the bird tears through.
7. **2:15–2:40:** an egg sac fed and hatching; spiderlings balloon to the real walls.
8. **2:40–2:55:** the next morning: the room with its small webs, the spider waiting. Title card last.

## Testing instructions (for the Devpost form)

Open the link in the Meta Quest browser on a Quest 3 with your room set up (Settings, Physical Space, Space Setup) and hand tracking on. Sit down, tap "enter", and use your hands only. Swing the spider toward your walls to tie the web, tap your fingers to spin, hold still when the bird calls. A full session is about ten minutes; come back the next day to see the brood.

## Submission checklist (do in this order, 17 Nov evening)

1. **Freeze the build.** After the headset test and any last tuning: `npm run deploy`, then `git tag competition-submission && git push origin --tags`. No deploys after submitting; the entry must stay unchanged until the winner announcement (around 11 Dec).
2. **Record on the Quest 3.** Settings, Camera, Record video (passthrough is captured). Good daylight in the room so passthrough is clean. Record each beat of the shot list as its own clip, several takes; the hook shot (the bird through the finished dewy web) is easiest with `?fast&bird`. Pull the clips off with the Meta Quest Developer Hub or a USB cable.
3. **Cut the video** to under 3 minutes (the shot list above), real footage only, no AI video, no music you do not own (the game's own sound is fine and original). Export 1080p. Upload to YouTube as Public (not Unlisted: the rules say publicly visible). Copy the link.
4. **Stills.** Four to six frames from the clips for the Devpost gallery: the descent, the scaffold swing, the dewy web, the bird, the spiderlings on a real wall, the morning after.
5. **Devpost form** (https://start-developer-competition-26.devpost.com, Enter a Submission). Be logged in with the account that joined the hackathon and is a Meta VR Start member. Fill in: project name; tagline (above, under 140 characters); description (above); "built with" tags (WebXR, IWSDK, three.js, TypeScript, Vite, GitHub Pages); the playable link https://mohaulik.github.io/nxt-spider-web/; the video link; the GitHub repo link; Track: Gaming; Division: New Experience; target launch date; the testing instructions above; the hand-interactions list above. Tick any special awards the form offers (Best First Five Minutes, Best Reason to Come Back). Paste-ready text: DEVPOST_FORM.md.
6. **Submit**, then open the public project page and check the video plays, the link opens in the Quest browser, and the text reads well. Keep a copy of everything (the rules ask you to retain a copy of your entry).
7. **Deadline: 18 Nov 2026, 12:00 PM PST = 21:00 Danish time.** Aim to be done the evening of the 17th.
