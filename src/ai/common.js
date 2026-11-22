// What the bots share. Each bot keeps its own random stream, so a bot's answers do not depend on the others.

import { nextRandom } from '../engine/rng.js';

/**
 * The option with the best score, ties broken at random: every option draws one number from `r`, so adding or
 * removing a call to pick shifts every later tie-break (keep them when a clean-up must not change any decision).
 */
export function makePick(r) {
    return (opts, score) => {
        let best = null, bestScore = -Infinity;
        for (const o of opts) {
            const sc = score(o) + nextRandom(r) * 1e-3;
            if (sc > bestScore) [best, bestScore] = [o, sc];
        }
        return best.id;
    };
}

/** The view with aircraft `id` moved to `pos` (a hex and a facing), to score where a flight ends. */
export const withAircraft = (view, id, pos) => ({ ...view, aircraft: { ...view.aircraft, [id]: pos } });
