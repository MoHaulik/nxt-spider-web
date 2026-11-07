// Every tuning number in one place. Distances in metres, times in seconds.
// The web lives in its own frame: origin at the web centre, +x right, +y up, +z toward the player.

const q = new URLSearchParams(location.search);
export const FLAGS = {
  fast: q.has('fast'), // compress the intro and the weather clock for testing
  rain: q.has('rain'), // start with rain
  fresh: q.has('fresh'), // ignore any saved web
  debug: q.has('debug'),
  closeup: q.has('closeup'), // desktop preview: camera close to the web
  bot: q.has('bot'), // desktop preview: a hand that plays by itself
};

export const CFG = {
  // where the web sits relative to your head when it is first placed
  webDistance: 0.72,
  webDrop: 0.12, // below eye height
  // comfortable seated hand rest relative to the head (used before the hand is first seen)
  handRestForward: 0.34,
  handRestDrop: 0.28,

  // hand -> spider mapping
  gainX: 2.6,
  gainY: 2.2,
  gainZ: 0.5,
  pendulum: 0.3, // effective dragline length the spider swings on
  spiderGravity: 0.7, // in g
  assistBase: 9, // spring pulling the spider toward where your hand says (grows with size)
  assistMax: 24,
  swingDamp: 1.9,
  boundsBase: 0.42, // how far from the centre the spider may roam (grows with size)
  boundsMax: 0.75,

  // silk
  silkGravity: 0.12,
  airDrag: 1.1,
  wetMass: 1.4, // extra weight of fully soaked silk
  iterations: 10,
  spacing: 0.028, // particle spacing along spun threads (also the capture spiral's pitch)
  tension: 0.965, // threads shrink to this fraction when tied off, so they hang taut
  snapRadius: 0.085,
  maxThread: 1.0,
  baseThick: 0.00042, // radius of a dry thread at the start
  maxThick: 0.0011,
  decay: 1 / 210, // health lost per second by an unvisited thread
  decayCapture: 1 / 160,
  decayMoor: 1 / 1400,
  sag: 0.32, // how much longer a dying thread grows before it snaps
  repairRadius: 0.06,
  rungMin: 0.03,
  rungMax: 0.2,

  // flies
  flyLength: 0.011,
  flyFirstDelay: 2.5,
  flyInterval: [7, 14] as [number, number],
  flyEscape: 22,
  eatRadius: 0.05,
  eatHold: 0.55,

  // growth: size multiplier is 1 + growMax * (1 - exp(-food / growK))
  spiderLength: 0.024, // body length at size 1; legs span about 4x this
  growMax: 1.25,
  growK: 9,
  hunger: 1 / 600, // food lost per second when you stop eating (slims back down)

  // weather
  firstRain: 125, // seconds into free play
  rainLength: 75,
  rainGap: [200, 320] as [number, number],
};

if (FLAGS.fast) {
  CFG.firstRain = 25;
  CFG.rainGap = [40, 60];
}
