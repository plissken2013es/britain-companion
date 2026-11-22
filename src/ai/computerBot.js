// The "Computer" player (docs/02 §6.3): the bot that plays each side of each scenario best. The choice lives in the
// scenario file, `"bot": { "raf": "greedy" }`, measured with `node tools/arena.mjs --duel <a>,<b>`; a side without
// it gets the heuristic bot. As in 61_Undaunted_Normandy, so a stronger or a scenario-specific bot can take over one
// side without touching the rest.

import { SIDES, scenarioById } from '../engine/data.js';
import { heuristicBot } from './heuristicBot.js';
import { greedyBot } from './greedyBot.js';
import { randomBot } from './randomBot.js';

/** Every bot by name (the arena and the advice tool take these names). */
export const BOTS = { heuristic: heuristicBot, greedy: greedyBot, random: randomBot };

/** Which bot plays `seat` in `scenario` (a key of BOTS). */
export function botFor(scenario, seat) {
    return scenarioById(scenario).bot?.[SIDES[seat]] ?? 'heuristic';
}

export function computerBot(scenario, seat, seed) {
    return BOTS[botFor(scenario, seat)](seed);
}
