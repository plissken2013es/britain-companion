// Uniform random legal choice with its own seeded generator (it never touches the game's RNG). Prefers not to end
// the turn or skip while it still has something to do, so random games actually fight.
import { seedFrom, nextRandom } from '../engine/rng.js';

const IDLE = new Set(['end', 'dark', 'none', 'done', 'stop']);

export function randomBot(seed = 'bot') {
    const r = { rng: seedFrom(seed) };
    return (request) => {
        let opts = request.options;
        const busy = opts.filter((o) => !IDLE.has(o.id));
        if (busy.length && nextRandom(r) < 0.8) opts = busy;
        return opts[Math.floor(nextRandom(r) * opts.length)].id;
    };
}
