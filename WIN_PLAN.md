# How Gossamer wins: research and plan (17 Nov 2026)

## What the official pages say (specifics)
Sources: [judging](https://start-developer-competition-26.devpost.com/details/judging), [rules](https://start-developer-competition-26.devpost.com/rules), [last year's winners](https://developers.meta.com/horizon/blog/meta-horizon-start-developer-competition-meet-the-winners/), [use cases](https://developers.meta.com/horizon/discover/use-cases/).

- **6,615 registered participants.** Judging has two stages. Stage 1 is a pass/fail check that the entry fits the theme and uses the required features (hands-first). Stage 2 scores four equally weighted criteria. **One prize per entry.** "AI tools may also be used to assist in the judging", so the text should use the rubric's own words.
- **Innovation & Creativity:** "uniquely leverage Meta device capabilities (spatial depth, hands-first design, gaze, passthrough mode, scene understanding, persistent anchors) **to drive repeat usage**."
- **Experience Design:** "intuitive navigation from the moment of entry, clear onboarding, and a rewarding, **habit-forming** purpose." Passthrough must be purposeful: "the player's real room should meaningfully change the experience, whether a table becomes the play surface, **walls host content**…".
- **Technical:** "min **60 fps**", "solid and bug-free", "anchoring content to detected planes, surfaces, and room geometry, and **holding up in rooms the developer never tested**."
- **Polish & Presentation:** UI/UX, art direction, sound, *and the submission materials*. Video: "show real gameplay… **lead with the story** and what makes your project distinct."
- **Special awards** ($25k each; Judge's Choice 2 × $20k):
  - **First Five Minutes:** "how fast the experience explains itself, teaches controller-free interaction without a wall of text, and delivers a payoff before the user takes the headset off."
  - **Reason to Come Back:** "something to work toward, visible growth between sessions, a loop that pulls the user back tomorrow."
  - **Boldest Original Concept:** "the idea that couldn't exist anywhere else… whether the experience would fall apart on any other platform."
  - Also: Accessibility Forward, Social & Multiplayer, Agentic Interaction (not a fit for us).

## What separated last year's winners
- **Tiny Golf** (Best Casual Game, $100k): "all you need is a pinch". Mini golf in your real room, and you can build your own courses. *One verb, in your room, and creation.*
- **Little Critters** (runner-up studio; UploadVR's MR game of 2025): scene tracking drives the gameplay, and hands "slap, squash, throw and poke" the critters. *Hands that touch living things.*
- **Three $50k awards just for hand interactions.** Meta pays for tactile hands.
- The IWSDK showcase features **Nanauts**: small creatures that visit your living room. That's close to our spiderlings. The idea is in the air, so ours has to be the most beautiful version.

**What separates a winner from a finished entry:**
1. One verb anyone gets in seconds.
2. Your real room *is* the game.
3. Hands that touch living things.
4. A payoff inside the first minute.
5. A reason to come back that you can actually *see*.
6. A video that leads with a story.

## Where Gossamer stands on each axis
- **Innovation:** strong. Scene understanding (scaffold to real walls, brood on real surfaces), persistent anchors, passthrough, hands, real time of day. Gaze isn't used.
- **Experience Design:** the first meal arrives inside a minute. The measured problem is the middle of the session (below).
- **Technical:** bug-free in emulator runs. **60 fps on a Quest is unproven.** A fallback exists for unscanned rooms (automatic Space Setup prompt, floor fallback).
- **Polish:** a coherent art direction with no UI, all-original synthesized sound and a generative score. The video doesn't exist yet.
- **Best award bets:** Boldest Original Concept, Reason to Come Back, First Five Minutes. Then the Gaming New Experience top prize.

## The honest playthrough: where someone quits
Measured in a 10-minute normal-speed session in the Quest 3 emulator, with a bot playing efficiently:

| Time | What happened |
|---|---|
| 0:18 | Control starts |
| 0:58 | First meal (good First Five Minutes) |
| to 2:30 | Ten meals |
| 2:39 | Bird (−28% of the web, as designed) |
| 3:08–4:14 | **Rain: 66 s with no flies**; web health 0.95 → 0.39 |
| 4:19 | **The web collapsed: 149 → 47 threads at once** |
| after that | **No meals and no eggs for the rest of the session.** The nest only counts meals after the bird, and nothing could catch flies any more |

**Diagnosis:** the first rain wiped out the web, and nothing told you to rebuild. The eggs and spiderlings, which are our "reason to come back", would never appear in a judge's 10 minutes.

## Implemented today (live)
- **Flies react to your hands.** A fly near your hand flees, always toward the web (away from you), and a deliberate fast sweep carries it along, so you can shoo flies into the silk. A startled fly's buzz rises. Normal steering moves are too slow to fling flies around. A first version that pushed flies directly away from the hand cut catches from 3 to 1 in a test run; this version restores them.
- **Rain weighs the web down but no longer kills it** (wet decay ×1.25 instead of ×2.2), and it lasts 50 s instead of 75.
- **The web ages gradually:** half the decay speed, and each thread ages at its own rate, so old threads sag and fail one by one as a warning instead of the whole web collapsing at once.
- **Eggs are reachable in a normal session:** 3 meals after the bird fill the nest (was 4), 2 meals feed the sac (was 3), and a fed sac brings the next rain closer.
- **If the web is badly damaged, the pinch cue returns** so the player knows they can rebuild.
- From earlier today: the `?fps` readout; a resting lap hand can't steal the steering; recovery if the first fly escapes; the spider stays on its web on its own.

**Measured after the fixes** (normal speed, emulator bot):
- the web survives the first rain intact (161 → 161 threads);
- no mass collapse (161 → 141 over five minutes);
- in an earlier run, the eggs were laid at 4:49 and hatched into two families by about 7:20.

The bot only chases caught flies and never sweeps the spider around to relay the spiral, so after the bird its catch rate falls. **Watch for this in the headset test:** does a person naturally rebuild after the bird? If not, the spiral should regrow more by itself.

## Bigger swings: these need Morten's sign-off (little time left; each should be tested on a headset)
1. **A fly lands on your finger.** Hold a hand still and open, and a passing fly may land on your real fingertip, crawl, and clean its wings; flick it toward the web. The most tactile, most "only in MR" moment we could add, and the hook shot for the video. About 2 hours plus a headset test.
2. **Real objects hide the web** (WebXR depth sensing, `iwsdk-depth-occlusion`). A person or chair in front of the web hides it properly. That addresses "holding up in rooms" and Technical. Frame-rate risk on Quest, so test with `?fps`. About 1–2 hours.
3. **Gaze:** the spider looks where you look, and lingering on a caught fly sends it there when your hand rests. Gaze is in the Technical rubric. Needs Quest Pro or Quest 3 gaze support; check first.
4. **Accessibility pass:** a one-handed mode is already implied; add a "hold still to spin" alternative to the pinch, for hands that can't pinch. That could strengthen the Accessibility Forward case. About 1 hour.

## Video: what the rubric asks for, and what wins
Lead with the story, in real gameplay:
- the ceiling glint and the descent;
- the swing that ties lines to *your* walls;
- the first catch;
- **shooing a fly into the web with your hand**;
- rain on the web, then the sun on the dew;
- the bird;
- spiderlings ballooning to your real walls;
- the next morning.

No text over the footage except the title at the end. The game's own sound only.
