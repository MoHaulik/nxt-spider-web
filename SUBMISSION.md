# Gossamer: submission draft

Draft for the Devpost form (Meta VR Start Developer Competition 2026). Edit freely; the numbers in brackets are things to fill in after device testing.

**Project name:** Gossamer

**Tagline (125 / 140):**
A spider descends into your real room. Your hand guides it, a pinch spins silk, and over the days its brood claims your room.

**Track:** Gaming
**Division:** New Experience (conceived and built from 6 November 2026; the repository history starts that day)

**Playable link:** [GitHub Pages URL]
**Video:** [YouTube/Vimeo, under 3 minutes, recorded on Quest 3]

---

## Description (~500 words)

**Inspiration.** Everyone has watched a spider come down on a single thread and stopped what they were doing. We wanted that moment in mixed reality, and we wanted it treated like cinema, not a toy. Gossamer has no words, no menus and no score on screen. Your room dims, something glints at your ceiling, and a spider lowers itself, perfectly straight, until it hangs at arm's length in front of you. Then it is yours.

**How it plays.** Move your hand and the spider swings with it on its dragline, like a pendulum with real weight. Tap your fingers together and it starts a thread; swing, tap again, and the silk ties off, pulled taut. Swing a thread across the middle and the spider lays it as two true radii through a hub. Between your radii it lays the sticky spiral itself, one turn at a time from the outside in, the way orb-weavers really build. You choose the architecture and the spider does the craft. But silk is not free: the spider can only spin what it has eaten for, and you see its reserve in how plump it is. The web grows exactly as fast as the little ecosystem feeds it. You don't chase flies. The web catches them. A caught fly shakes the whole web, and the spider feels it: rest your hand and it goes by itself, binds the fly in silk turn by turn (your taps help), and eats. Time slows, a warm chord plays, and the spider grows a little larger and quicker, and spins thicker silk. Threads you stop visiting sag and snap. Reach out and pluck a thread with your fingertip: it rings and sways, and the spider turns to look. When it rains, beads of water form along every thread at the spacing real dew forms. Each bead is a tiny lens, inverted and edged with spectral colour. When the rain stops, low sun turns the whole web to light.

**Your room matters.** Gossamer reads the room the headset has scanned. The dragline hangs from your actual ceiling, and the frame lines tie off to your real floor, walls, tables and sofa, so every room gives a different web. After enough meals the spider grows heavy with eggs. Leave it be and it climbs to a sheltered corner of the frame and slowly spins a sac. The sac waits for warmth: when the sun comes back after rain, it trembles and opens, and a ball of spiderlings balloons out on silk to real surfaces around you (wall corners, the edge of a shelf, under a table). A few families settle and build their own small webs there, and they catch the flies that slip past yours. The web stays anchored where you left it. While you are away the spider lives on: it wraps the flies it catches and stores them in the web for you, and its families grow. Come back tomorrow and your room has a little more silk in it. Gossamer also keeps your real time of day: mornings the web is beaded with dew and lit gold (and a waiting sac hatches in that first sun), evenings are amber, nights are cool moonlight.

**How we built it.** WebXR on Meta's Immersive Web SDK (IWSDK) with three.js, hosted on GitHub Pages. Everything is procedural and original: the spider, flies, silk, dew, sound. The web is a position-based (Verlet) simulation of several thousand silk particles with rope constraints, sag from loss of health, and snapping. Silk renders as one camera-facing ribbon mesh with an anisotropic highlight and a diffraction-style spectral band. Dew renders as instanced ball-lens impostors with per-channel refraction. Room integration uses WebXR plane detection and persistent anchors. Real hands stand in front of the web through depth-only hand occluders. All audio is synthesized and tuned to a pentatonic scale, so plucking the web plays it. A generative felt-piano score is made of the ecosystem itself: sparse while the web is young, fuller as it grows, darker in rain, brighter when the sun returns. The landing page says one line, your chapter of the story: Build a home. Maintain a web. Grow a family. Let them go. Fill the room.

**What's next.** More species with different web architectures, seasons and morning dew tied to your local time, and shared rooms where two people's spiders build together. Target launch: [month 2027] on the Meta Horizon Store as a free web app.

---

## Hand interactions (for the form)

- **Move your hand:** the spider swings with it on its thread. It works seated, with about 20 cm of hand movement.
- **Pinch and swing:** spin silk. **Release** near another thread to tie it off.
- **Rest your hand:** the spider acts on its own. It goes to caught flies, binds and eats them, and goes to lay its eggs.
- **Tap at a caught fly:** a turn of silk around it.
- **Pluck a thread with your fingertip:** it rings and sways.
- **Brush the spider past threads:** repair them.
- No controller, no menus, no buttons in the world. The first time it's needed, a soft cue at your fingertips shows the pinch.

## Judging checklist

- Hands-first end to end. Controllers optional (trigger = pinch).
- Seated: every interaction within a two-foot radius. The web sits in the central field of view.
- Fast cold start. Pause on the system menu, autosave, resume where you left off.
- The first complete moment (first fly caught and eaten) arrives within about 4 minutes.
- Passthrough is purposeful: ceiling, floor, walls and furniture hold the web and the colonies.
- Persistent anchors keep the web in place between sessions.
- Performance target: 72 fps on Quest 3. [confirm on device]

## Video plan (under 3 minutes, captured on Quest 3)

1. **0:00–0:25:** the room dims, the ceiling glint, the descent. No cuts.
2. **0:25–0:55:** the hand swings the spider; first threads; the spiral breathing in.
3. **0:55–1:25:** a fly arrives by sound, gets caught, the slow-motion meal, the spider grows.
4. **1:25–2:05:** rain on the web. Close on the dew, then the afterglow, and a pluck of a wet thread.
5. **2:05–2:40:** an egg sac quivers and hatches, and spiderlings balloon to the real walls.
6. **2:40–2:55:** the next morning: the room with its small webs, the spider waiting.
