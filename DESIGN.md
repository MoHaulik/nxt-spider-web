# Spinner (working title): direction, v0

A spider lowers itself from your real ceiling. You move it with your hand and spin a web across your real room. Flies come, you catch them, and the spider grows. Rain makes the web beautiful and heavy, and you have to keep it alive.

Meta VR Start Developer Competition 2026: **Gaming track, New Experience division.**
Deadline: **Wed 18 Nov 2026, 12:00 PST (21:00 CET)**. We submit on the evening of the 17th.

---

## 1. What the rules actually reward (devpost rules, read 6 Nov)

| Rule / criterion | What it means for us |
|---|---|
| Hands-first (hard requirement) | Pinch is the only "button". There is no controller path, and none is needed. |
| Seated, 2 ft radius | The hand only moves about ±20 cm. A gain maps that onto a web up to about 1.5 m wide. You never reach for the spider. |
| ≤10 min satisfying, clean pause/resume | The first fly is caught and eaten by about 3:30. State is saved on every eat and on `visibilitychange`. |
| "Passthrough should be purposeful: the real room meaningfully changes the experience" | **The web is tied to your real room**: the dragline hangs from the detected ceiling, and frame threads run to real table edges, walls and the sofa (scene understanding). A different room gives a different web. |
| "Correct use of MRUK, anchoring to planes… holding up in rooms the dev never tested" | We use planes and meshes from IWSDK's SceneUnderstandingSystem. Where the room has no data, we fall back to virtual anchors. Room setup is never a blocker. |
| Technical: hand tracking, passthrough, anchoring, FoV-aware, **≥60 fps** | The web plane sits in the central ~60° of view. Budget: 72 fps on Quest 3. |
| Submission path is literally "apps built with IWSDK (WebXR)" → GitHub Pages | This counts strongly for IWSDK (see §5). |
| Video: real gameplay, no AI video | Captured on device. |
| Special awards: **Best First Five Minutes**, **Best Reason to Come Back** ($25k each) | The cinematic intro is aimed at the first. A persistent web that is still in your room tomorrow is aimed at the second. |

## 2. Eligibility call: New Experience ✅

I agree with the call: build from scratch in this repo, and don't fork or copy `nxt-thing-hand`.

- "No pre-existing codebases" is the risk. Concept, code and assets are all new as of today (6–7 Nov, inside the window).
- One thing to be aware of: *die Hände* already has a small prop spider in a web (it flees, and lowers itself on a thread). That is a background detail in a different game, not this game. I have **not opened or reused** that code. I only read Thing's README and its session-setup line. The tech stack is also different (IWSDK/Vite/three r185 vs single-file three r150), so there is no shared code to point at.
- Suggestion: `git init` this repo now and commit often. The dated history is our proof of "conceived and built in the window".

Adapted would only make sense if this were a mode inside Thing. It isn't, and the New division is a separate prize pool, so this costs us nothing.

## 3. Research → decisions

### 3a. The web: physics
- **How real orb-weavers build** (Zschokke 1999; PMC8612999): proto-web → **frame + radii** (strong, dry silk) → **auxiliary spiral** (temporary scaffold) → **capture spiral**, laid from the outside in (sticky, stretchy, glue-beaded). Spiders patrol and repair their webs.
  → **Decision:** the player's spun threads are the radii and frame. Once a few radii exist, a *capture spiral fills in automatically, like breathing*, between them, so it looks expert-level without the player tracing a spiral. The player draws the architecture and the spider does the craft.
- **Simulation:** Verlet particles with distance constraints (position-based dynamics), 8–12 iterations, on a fixed 90 Hz substep. Each strand is a chain of 6–20 particles. Anchors are pinned (inverse mass 0). Junctions are shared particles, so a pluck travels through the whole web. Mild "air" damping and a little wind noise keep it alive at rest.
- **Decay ("maintain the old web"):** every strand has `health` that slowly decays. **The spider walking along a strand repairs it.** As health drops, rest length grows: first it sags visibly, then it goes slack, then it **snaps** (the constraint is removed). Snapped halves fall, curl and drift for a few seconds, then dissolve. Rain adds water mass and accelerates sag, which creates tension: the web is at its most beautiful when it is most at risk.
- **Catch:** a fly segment that intersects a capture strand sticks with a probability based on strand thickness and fly speed. A struggling fly tugs the web, so you *see and hear* where it is.

### 3b. The spider: original minimalist design
Sources agree that appeal comes from *coordinated restraint*, not detail: readable silhouette first, deliberate proportions, exaggeration with a purpose.
- **Silhouette:** a small, slightly elongated opal-pearl **abdomen** (the "jewel"), a smaller cephalothorax, and **8 long, very thin legs** with 2 visible bends. In silhouette it reads as "spider" instantly, but elegant, like a sketch with one line per leg.
- **No hair, no visible fangs, no 8-eye cluster.** Two tiny glossy front eyes are the only face, a single catch-light each. They make it a character without making it cute.
- **Material:** abdomen in a soft warm ivory-to-amber with subsurface glow and a faint iridescent sheen (thin film). Legs in matte graphite, tapering to hair-thin tips.
- **Motion carries the character:** an alternating-tetrapod gait (two groups of 4 legs; front pair used as feelers, per the literature) driven by procedural IK onto the strands. Small anticipatory pauses and a pluck-check before each move.
- **Growth:** about 2.5× over a long session (start about 1.2 cm body, real garden-spider size). Speed and silk thickness rise with it, but with **diminishing returns** (log curve) so it keeps feeling earned. If you skip meals it slowly slims back down. That is the "faster/slower depending on how much you eat" loop.

### 3c. Rain and droplets on silk
- **Physics of the look:** a thin water film on a fibre breaks into **evenly spaced beads** (Plateau–Rayleigh instability). Spacing scales with fibre thickness, and big beads slide and merge under gravity. The sticky capture spiral naturally carries regular glue beads too.
  → **Decision:** beads are placed at spacing ∝ strand radius, grow during rain, and the biggest **slide to the low point of each sagging strand and drip off**. This happens for free from the sag simulation.
- **Optics:** each bead is a tiny **ball lens**. It shows an inverted, shrunken image of the bright background, a sharp specular glint, and **spectral fringes at the edge** (dispersion). That looks best **backlit**, which is why dew photographers shoot into the sun. Dry silk shows rainbow colours from **diffraction** (strongest when out of focus and backlit) and is distinct from the droplets.
  → **Decision:**
  - Droplets: an instanced sphere impostor shader (1 quad per drop, up to about 3k). Fresnel rim, per-channel IOR (R 1.331 / G 1.335 / B 1.340) refraction into a soft environment map, a hard specular glint, and an **inverted "window" highlight** (the ball-lens tell). Edge chromatic fringe.
  - Silk: camera-facing ribbon strands with an anisotropic highlight (Kajiya-Kay style) and a **view-angle-dependent spectral band** (diffraction approximation), so threads catch rainbow streaks as your head moves.
  - **One virtual "sun" key light** placed behind the web relative to your head. It is a cinematic cheat to keep everything backlit, the way photographers shoot dew.
  - Honest limit: WebXR doesn't give us the passthrough image as a texture by default, so drops refract a *designed* warm environment, not your actual room. On a dimmed passthrough this reads as glints and light, which is the look in the reference photos anyway. (Quest's newer WebXR camera access could make drops refract the real room. It's a stretch goal only if it's stable on device.)

### 3d. Flies: "photorealistic"
A real housefly is about 7 mm, a few pixels at 70 cm. **Decision:** scale it to about 1.4× real and shoot it in "macro" (a shallow depth-of-field fake on the fly only). Build it procedurally, no third-party models (keeps the "original" rule clean): a dark body with a bronze-green metallic thorax, **deep red compound eyes** (micro-faceted normal pattern), and **thin-film iridescent wings** blurred by a motion-blur fin at 200 Hz. Flight uses a wander/steer model that is drawn to the web's glints. The buzz is synthesized and spatialized with doppler, and that buzz tells you where to look before you see it.

## 4. The first ten minutes (no wall of text)

| t | Beat |
|---|---|
| 0:00 | Enter. Your room fades to a dim, warm grade. Silence, then a single low tone. |
| 0:15 | A glint high up, at your *real ceiling*. A single dragline catches the light and draws down slowly, perfectly straight (the Kubrick shot). The spider rides it down to eye level, about 70 cm in front of you, and stops. It turns to you. |
| 0:45 | **Swing.** Raise a hand and a faint silk line links your fingertips to the spider. Move your hand and it swings like a pendulum, with real momentum. No text. A ghost hand demonstrates only if you haven't moved in 6 s. |
| 1:30 | **Spin.** The spider touches a real surface (table edge or wall) and silk sticks. A ghost pinch appears. Pinch while moving to pay out silk, release to cut. Thin, glinting, a soft pluck sound. |
| 2:30 | After about 4 strands the capture spiral breathes in between them. A buzz on your left. |
| ~3:30 | **First catch.** The web shudders, the fly struggles, and the strand rings. Swing over and hold: a slow-motion beat, the wrap, a warm chord, and the spider visibly grows. **This is the complete moment for the "bus stop test".** |
| 4–10 min | The loop. More flies (some faster, a rare golden one), a bigger web, and the first strand starts sagging. **Rain** arrives around 6 min: the money shot for the video. |
| Next day | The web is where you left it (anchors + saved state). The spider is waiting, a bit hungry, and some strands have sagged overnight. |

Pause/resume: the system menu or headset off pauses the sim instantly and saves. On resume the room is re-localized and play continues.

## 5. Platform decision: **build on IWSDK** ✅

I scaffolded and built a throwaway IWSDK AR project (`npm create @iwsdk@latest -- --target ar --scene-understanding`). It installs and builds cleanly. The gzipped bundle is about 670 KB, fine for a fast cold start.

What it gives us that matters for judging:
- `immersive-ar` session plus a hand-tracking flag, and `planeDetection`, `meshDetection` (with **semantic labels**: table, wall, couch…), `anchors`, `hitTest`, and `depthSensing` (**real hands occlude the web**). All of it is config flags.
- `SceneUnderstandingSystem` with `XRPlane` / `XRMesh` / `XRAnchor` ECS components, plus environment raycast. That is exactly "anchor to planes and room geometry".
- **IWER emulator** in the Vite dev plugin. We can test hands and the room on the Mac without a headset every iteration, which is a real speed boost with 11 days left.
- The rules' own submission wording is "apps built with IWSDK (WebXR)". "Strategic use of platform tools" is scored.

Costs, accepted:
- It's a Vite/TypeScript project, not a single HTML file. Fine, it deploys to GitHub Pages / nxtwebxr.com the same way.
- `1.1.0-rc.2` is the `latest` tag, so we **pin exact versions**.
- three.js is `super-three@0.185` underneath. We still write our own `ShaderMaterial`s for silk, droplets and fly (raw three is fully accessible).
- We do **not** use IWSDK grabbing, locomotion or physics (Havok). The web needs our own Verlet solver, and locomotion is irrelevant seated.

## 6. Performance budget (Quest 3, 72 fps)
- Silk: about 400 strands × up to 20 particles, solved on the CPU in a typed-array solver (no per-particle objects). Rendered as **one** ribbon mesh with a dynamic buffer.
- Droplets: one instanced draw. Flies: ≤6 alive, one draw each. Spider: one skinned-free procedural mesh (legs are instanced segments).
- Foveation and frame-buffer scale tuned on device. No post-processing passes; DOF and glow are done in-material.

## 7. Audio (it's 25% of "Polish")
Synthesized and spatial. A felt-piano/glass-harmonica tone family. Strands are tuned, so plucking the web plays the web, with pitch from tension. The fly buzz has doppler. Rain on silk is soft ticks, plus room tone. Eating gets a warm two-chord resolve. The music thins as the web decays and blooms as it grows.

## 8. Schedule (planned backward from 18 Nov, 21:00 CET)

| Day | Goal |
|---|---|
| Sat 7 – Sun 8 | IWSDK project; hand → spider pendulum mapping tuned in IWER and on device; Verlet web + pinch spinning |
| Mon 9 – Tue 10 | Spider character + gait; flies, catch, eat, growth curve |
| Wed 11 – Thu 12 | Decay/repair; rain + droplet + silk shaders |
| Fri 13 | Room anchoring (ceiling/table/wall), fallback anchors, persistence, pause/resume |
| Sat 14 – Sun 15 | Intro cinematography, audio pass, on-device perf (≥72 fps), testing in 2–3 different rooms |
| Mon 16 | **Feature freeze.** Capture the gameplay video on device |
| Tue 17 | Edit the video (<3 min), write the form text, **submit Tuesday evening** |
| Wed 18 | Buffer only |
