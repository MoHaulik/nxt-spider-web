# Gossamer

A spider descends into your real room. Your hand guides it, a pinch spins silk, and over the days its brood claims your room.

Hands-first mixed reality for Meta Quest, in the browser: WebXR on Meta's Immersive Web SDK (IWSDK) and three.js. No controllers, no menus, no words in the world.

**Play:** open **https://mohaulik.github.io/nxt-spider-web/** in the Meta Quest browser and tap *Enter your room*. Best seated, with your room set up on the headset. On a desktop the same page runs a preview: the mouse is your hand, hold the button to spin.

## What happens

- Your room dims. Something glints at your ceiling, and a spider lowers itself, perfectly straight, to hang at arm's length.
- Move your hand and it swings with you on its dragline. Pinch while you swing to pay out silk, and let go near another thread to tie it off.
- Frame lines tie off to your real floor, walls, furniture and ceiling (plane detection). Threads swung across the middle become true radii through a hub, and the sticky spiral lays itself in rings between them, outside in.
- Flies come for the glints. A caught fly shakes the web; hold the spider over it to eat. The spider grows larger and quicker and spins thicker silk, and slims down if it goes hungry.
- Threads you don't revisit sag and snap. Brushing past repairs them.
- Rain beads every thread with dew, each drop a small ball lens. When it stops, the sun comes back onto the wet web.
- Every sixth meal, an egg sac. It hatches into a ball of spiderlings that balloon out to real surfaces in your room and build their own small webs.
- The web stays anchored where you left it (persistent anchors). While you're away, the spider stores wrapped meals in the web and its families grow.

## Build

```bash
npm install
npm run dev        # https dev server; open the Network URL on a Quest on the same Wi-Fi
npm run build
npm run deploy     # build and publish to GitHub Pages
```

URL flags for testing: `?fast` (short intro, quick weather and hatching), `?rain`, `?fresh` (ignore the saved web), `?closeup` (desktop camera close to the web). Desktop keys: `f` fly, `r` rain, `n` next beat, `e` egg sac, `h` hatch.

## Code

- `src/game/game.ts`: the beats, the spider's swing, spinning, feeding, weather, saving
- `src/game/web.ts`: Verlet silk simulation, decay, repair, persistence
- `src/game/render.ts`: silk ribbons, dew-drop lenses, the dimmed room
- `src/game/spider.ts`, `flies.ts`, `brood.ts`: the creatures
- `src/game/room.ts`: room planes to frame anchors and nesting sites
- `src/game/hands.ts`: hand joints, pinch, depth-only hand occluders
- `src/game/audio.ts`: synthesized, spatialized sound
- `src/game/config.ts`: every tuning number

Everything is procedural and original. Built for the Meta VR Start Developer Competition 2026.
