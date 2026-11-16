# Gossamer

A spider descends into your real room. Your hand guides it, a pinch spins silk, and over the days its brood claims your room.

Hands-first mixed reality for Meta Quest, in the browser: WebXR on Meta's Immersive Web SDK (IWSDK) and three.js. No controllers, no menus, no words in the world.

**Play:** open **https://mohaulik.github.io/nxt-spider-web/** in the Meta Quest browser and tap *Enter your room*. Best seated, with your room set up on the headset. On a desktop the same page runs a preview: the mouse is your hand, hold the button to spin.

## What happens

- Your room dims. Something glints at your ceiling, and a small spider lowers itself, perfectly straight, to hang at arm's length.
- Swing it with your hand, side to side. Where it swings out toward a real wall, the floor or a piece of furniture, it runs a line there and comes back: the scaffold of the web, tied to your room. Nothing ever breaks those lines. When every side is tied, the ring closes.
- Pinch while you swing to pay out silk, and let go near another thread to tie it off. Threads swung across the middle become true radii through a hub. The sticky spiral is laid a turn at a time, only where the spider is: bring it round the web and the spiral follows (rest your hand and it goes round by itself).
- Flies come for the glints. A caught fly shakes the web; touch it with the spider to eat. With every meal the spider grows, from a spiderling to a full garden spider, and spins thicker silk.
- Rain comes once there is a web worth keeping. Drops gather on the ceiling, swell, and let go: one on a thread tears it, one on the spider knocks it down its dragline. Dodge them. When the sun comes back the web is beaded and bright, and the flies feast.
- A bird. It calls first, from off to one side; the spider freezes. Hold still, or sit at the edge of the frame, and it passes. Move in the open and you are knocked down, and it tears what it flies through (never the scaffold).
- Only after all that: eggs. The nest fills with each meal, the spider spins a sac, and brings the next meals to it. Fed and warmed by the sun after rain, it hatches into a ball of spiderlings that balloon out to real surfaces in your room and build their own small webs.
- The web stays anchored where you left it (persistent anchors). While you're away, the spider stores wrapped meals in the web and its families grow.

## Build

```bash
npm install
npm run dev        # https dev server; open the Network URL on a Quest on the same Wi-Fi
npm run build
npm run deploy     # build and publish to GitHub Pages
```

URL flags for testing: `?fast` (short intro, quick weather, early bird and hatching), `?rain`, `?bird` (the first bird comes early), `?fresh` (ignore the saved web), `?closeup` (desktop camera close to the web), `?desktop` (force the mouse preview even with an XR emulator), `?hour=7` (morning dew). Desktop keys: `f` fly, `r` rain, `d` a heavy drop, `b` the bird, `n` next beat, `e` egg sac, `h` hatch.

## Code

- `src/game/game.ts`: the beats, the spider's swing, spinning, feeding, weather, saving
- `src/game/web.ts`: Verlet silk simulation, decay, repair, persistence
- `src/game/render.ts`: silk ribbons, dew-drop lenses, the dimmed room
- `src/game/scenery.ts`: lights, reflections, rain with depth
- `src/game/spider.ts`, `flies.ts`, `brood.ts`, `bird.ts`: the creatures
- `src/game/room.ts`: room planes to frame anchors and nesting sites
- `src/game/hands.ts`: hand joints, pinch, depth-only hand occluders
- `src/game/audio.ts`: synthesized, spatialized sound
- `src/game/config.ts`: every tuning number

Everything is procedural and original. Built for the Meta VR Start Developer Competition 2026.
