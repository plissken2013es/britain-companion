// Sound effects with the Web Audio API. From 59_BigTimeBoxing (and 58, 48 and 51 before it), with engines, machine
// guns, flak, falling bombs and aircraft going down; the recordings as in 61_Undaunted_Normandy:
// - machine-gun bursts: The Free Firearm Sound Library (CC0, the licence beside them, assets/sounds/fire/): the PPSh
//   for the RAF's eight Brownings, the Carl Gustav for the Luftwaffe's MG 17 (with a synthesised cannon thump);
// - cards (a card sliding, a deck shuffled): Kenney's Casino Audio (CC0, assets/sounds/cards/), as in 48;
// - engines (2026-11-18): Spitfires and Bf 109s passing overhead, recorded at air shows and shared on Freesound (CC0
//   and CC-BY 3.0, the credits in assets/sounds/engines/LICENSE.txt), cut by tools/engine_sounds.py.
// They are fetched and decoded up front (loadSamples); until they are, or if one fails, a synthesised sound plays.
// Everything else (flak, bombs, explosions, misses whizzing past, the ships...) is synthesised. ☰ turns it all off.
// The audio context is created lazily on first use (after a user gesture).

let ctx = null;
let master = null;
let muted = false;

function audio() {
    if (muted) return null;
    if (!ctx) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
    }
    if (!master) {
        master = ctx.createGain();
        master.gain.value = 0.3;
        master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/** 1..n */
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

/** Recorded sounds: a pool per name (one is picked at random each time, slightly retuned), its volume. */
const SAMPLES = {
    'raf-mg': { files: range(10).map((i) => `fire/raf-mg-${i}.wav`), gain: 0.42 },
    'lw-mg': { files: range(8).map((i) => `fire/lw-mg-${i}.wav`), gain: 0.42 },
    slide: { files: range(8).map((i) => `cards/card-slide-${i}.ogg`), gain: 0.55 },
    shuffle: { files: ['cards/card-shuffle.ogg'], gain: 0.6 },
    'raf-engine': { files: range(6).map((i) => `engines/raf-engine-${i}.wav`), gain: 0.5 },
    'lw-engine': { files: range(5).map((i) => `engines/lw-engine-${i}.wav`), gain: 0.5 },
};
/** file -> decoded AudioBuffer */
const buffers = new Map();
let loading = null;

/** Fetches and decodes every sample, once. Never fails: a missing one is synthesised instead. */
export function loadSamples() {
    if (loading) return loading;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return Promise.resolve();
    ctx ??= new AC(); // suspended until the first tap; decoding does not need it running
    const files = Object.values(SAMPLES).flatMap((x) => x.files);
    loading = Promise.all(files.map(async (f) => {
        try {
            const data = await (await fetch(`assets/sounds/${f}`)).arrayBuffer();
            buffers.set(f, await ctx.decodeAudioData(data));
        } catch { /* synthesised instead */ }
    }));
    return loading;
}

/** Plays one sample of a pool. @returns {boolean} whether it played (or would have, muted) */
function sample(name, { delay = 0, gain: level = 1 } = {}) {
    const pool = SAMPLES[name];
    const buf = pool && buffers.get(pool.files[Math.floor(Math.random() * pool.files.length)]);
    if (!buf) return false;
    const a = audio();
    if (!a) return true;
    const src = a.createBufferSource();
    const gain = a.createGain();
    src.buffer = buf;
    src.playbackRate.value = 0.94 + Math.random() * 0.12;
    gain.gain.value = pool.gain * level;
    src.connect(gain).connect(a.destination);
    src.start(a.currentTime + delay);
    return true;
}

/** One enveloped oscillator note. */
function tone(freq, dur, { type = 'sine', gain = 0.3, delay = 0, slideTo = null, attack = 0.01 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

/** A burst of filtered noise. */
function noise(dur, { gain = 0.25, delay = 0, freq = 1800, q = 0.8, type = 'bandpass', slideTo = null, attack = 0 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const len = Math.max(1, Math.floor(a.sampleRate * dur));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    filter.Q.value = q;
    const env = a.createGain();
    if (attack) {
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(gain, t + attack);
    } else env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t);
}

/**
 * A bullet flying past (from 61): a narrow band of noise that swells as it comes and fades as it goes, its pitch
 * dropping (the Doppler shift), with a faint whistle on top.
 */
function whiz(delay = 0, { gain = 0.22, from = 4200 + Math.random() * 1400, dur = 0.24 + Math.random() * 0.08 } = {}) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + delay;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(from * 0.32, t + dur);
    const env = a.createGain();
    const peak = t + dur * 0.45; // closest to the ear a little before the middle
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, peak);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t);
    const osc = a.createOscillator();
    const tenv = a.createGain();
    osc.frequency.setValueAtTime(from * 0.45, t);
    osc.frequency.exponentialRampToValueAtTime(from * 0.16, t + dur);
    tenv.gain.setValueAtTime(0.0001, t);
    tenv.gain.exponentialRampToValueAtTime(gain * 0.12, peak);
    tenv.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(tenv).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
}

export const sfx = {
    /**
     * A propeller engine passing: for an aircraft of `seat` (0 RAF, 1 Luftwaffe), a Spitfire's Merlin or a Bf 109's
     * Daimler-Benz recorded overhead; for a ship, or until the recordings are ready, a low synthesised buzz with wind.
     */
    engine(delay = 0, seat = null) {
        if (seat != null && sample(seat ? 'lw-engine' : 'raf-engine', { delay })) return;
        tone(90, 0.42, { type: 'sawtooth', gain: 0.05, slideTo: 130, attack: 0.08, delay });
        tone(180, 0.42, { type: 'square', gain: 0.015, slideTo: 260, attack: 0.08, delay });
        noise(0.4, { freq: 700, slideTo: 1500, q: 0.7, gain: 0.05, attack: 0.1, delay });
    },
    /** Banking: a short swish. */
    turn(delay = 0) { noise(0.18, { freq: 1200, slideTo: 2600, q: 0.9, gain: 0.06, attack: 0.05, delay }); },
    /**
     * A machine-gun burst of `seat`'s guns (0 RAF, 1 Luftwaffe): a recording, or quick synthesised cracks. The
     * Luftwaffe's also has the slow thump of the 20 mm cannon.
     */
    guns(delay = 0, seat = 0) {
        if (!sample(seat ? 'lw-mg' : 'raf-mg', { delay })) {
            for (let i = 0; i < 7; i++) {
                noise(0.035, { freq: 2200, q: 0.6, gain: 0.16, delay: delay + i * 0.055 });
                tone(140, 0.04, { type: 'square', gain: 0.05, delay: delay + i * 0.055 });
            }
        }
        if (seat) for (let i = 0; i < 3; i++) tone(70, 0.12, { type: 'sine', gain: 0.22, slideTo: 38, delay: delay + 0.05 + i * 0.16 });
    },
    /** Flak: dull thuds in the air. */
    flak(delay = 0) {
        for (let i = 0; i < 3; i++) {
            tone(85, 0.35, { type: 'sine', gain: 0.25, slideTo: 40, delay: delay + i * 0.16 });
            noise(0.3, { freq: 500, slideTo: 120, gain: 0.16, type: 'lowpass', delay: delay + i * 0.16 });
        }
    },
    /** A bomb falling: a whistle sliding down. */
    whistle(delay = 0) { tone(1500, 0.55, { type: 'sine', gain: 0.07, slideTo: 380, attack: 0.05, delay }); },
    boom(delay = 0, big = false) {
        tone(70, big ? 1.1 : 0.7, { type: 'sine', gain: big ? 0.55 : 0.4, slideTo: 28, delay });
        noise(big ? 0.9 : 0.5, { freq: 1100, slideTo: 80, gain: big ? 0.4 : 0.3, type: 'lowpass', delay });
    },
    /** Dice rattling. */
    dice() { for (let i = 0; i < 5; i++) noise(0.035, { delay: i * 0.055 + Math.random() * 0.02, freq: 2500 + Math.random() * 1500, gain: 0.22 }); },
    /** A missed burst: `n` bullets whiz past (up to 3, one a die), and now and then one ricochets. */
    miss(n = 1, delay = 0) {
        const k = Math.min(Math.max(n, 1), 3);
        for (let i = 0; i < k; i++) whiz(delay + i * 0.13 + Math.random() * 0.05);
        if (Math.random() < 0.35) sfx.ricochet(delay + k * 0.13 + 0.05);
    },
    ricochet(delay = 0) { noise(0.03, { delay, freq: 3500, q: 1.5, gain: 0.12 }); tone(2400, 0.35, { type: 'sine', gain: 0.05, slideTo: 900, delay }); },
    /** A bomb that falls wide: a dull thud and a splash of earth or water. */
    thud(delay = 0) { tone(90, 0.3, { type: 'sine', gain: 0.3, slideTo: 40, delay }); noise(0.35, { freq: 400, slideTo: 150, gain: 0.14, type: 'lowpass', delay }); },
    /** An aircraft going down: a falling whine, then the crash. */
    fall(delay = 0) {
        tone(900, 1.0, { type: 'sawtooth', gain: 0.045, slideTo: 140, attack: 0.05, delay });
        sfx.boom(delay + 0.9, true);
    },
    /** A card sliding or turning over (one of Kenney's eight card slides, at random). */
    card(delay = 0) {
        if (!sample('slide', { delay })) noise(0.05, { freq: 4000, q: 0.6, gain: 0.07, type: 'highpass', delay });
    },
    deploy() { tone(520, 0.08, { type: 'triangle', gain: 0.08 }); tone(780, 0.1, { type: 'triangle', gain: 0.06, delay: 0.07 }); },
    /** A deck being shuffled: Kenney's shuffle, or a synthesised riffle. */
    shuffle(delay = 0) {
        if (sample('shuffle', { delay })) return;
        for (let r = 0; r < 2; r++) {
            for (let i = 0; i < 14; i++) noise(0.018, { delay: delay + r * 0.8 + 0.25 + i * 0.022 + Math.random() * 0.008, freq: 4200 + Math.random() * 1800, q: 0.7, gain: 0.12, type: 'highpass' });
        }
    },
    /** Out of communications: radio static. */
    discord() { noise(0.35, { freq: 2500, q: 0.4, gain: 0.07 }); tone(1180, 0.25, { type: 'square', gain: 0.02, slideTo: 980 }); },
    /** A new round: two notes of a siren. */
    round() { tone(440, 0.5, { type: 'triangle', gain: 0.07, slideTo: 620, attack: 0.15 }); tone(620, 0.45, { type: 'triangle', gain: 0.06, slideTo: 440, delay: 0.45 }); },
    chime() { [660, 880].forEach((f, i) => tone(f, 0.18, { type: 'triangle', gain: 0.12, delay: i * 0.09 })); },
    win() { [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, { type: 'triangle', gain: 0.2, delay: i * 0.12 })); },
    lose() { [330, 311, 294, 262].forEach((f, i) => tone(f, 0.45, { type: 'sawtooth', gain: 0.08, delay: i * 0.18 })); },
};

/** @param {boolean} m */
export function setMuted(m) { muted = m; }
export const isMuted = () => muted;

/**
 * The sound stops while the page is hidden (another app, the phone locked) and comes back with it: an Android app
 * whose audio keeps running in the background is a store complaint (61 §7.12).
 */
export function pauseWhenHidden() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend();
        else if (!muted) ctx.resume();
    });
}
