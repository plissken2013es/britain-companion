// Static game data: card types, counters and scenarios (docs/01 §2). Card instances are "<side>:<type>:<n>", e.g.
// "raf:Y1:2"; aircraft are "<side>:<type>", e.g. "luftwaffe:Bace". Seat 0 is the RAF and seat 1 the Luftwaffe.

import cards from '../data/cards.json' with { type: 'json' };
import counters from '../data/counters.json' with { type: 'json' };
import { SCENARIOS } from '../data/scenarios/index.js';

export const SIDES = ['raf', 'luftwaffe'];
export const seatOf = (side) => SIDES.indexOf(side);

/** @type {Record<string, any>} "raf:Y1" → card type */
export const TYPES = {};
for (const side of SIDES) for (const c of cards[side]) TYPES[`${side}:${c.id}`] = { ...c, side, key: `${side}:${c.id}` };

export const typeOf = (cid) => TYPES[cid.slice(0, cid.lastIndexOf(':'))];

/** Aircraft type key of a counter id: decoys ("luftwaffe:G1~") and public aliases ("luftwaffe:G1@2") included. */
export const baseId = (id) => id.replace(/[~@].*$/, '');

/** "B*", "B★", "Y1" (counter unit as printed) → card type id. */
export const unitToType = (unit) => unit.replace(/[*★]/, 'ace');

/** Card name as in the scenario tables ("Y★ Hurricane") → type id. */
export function nameToType(side, name) {
    const n = name.replace('*', '★').trim();
    const c = cards[side].find((x) => x.name === n);
    if (!c) throw new Error(`unknown ${side} card in scenario table: ${name}`);
    return c.id;
}

/** Defence and firing lines of an aircraft type key ("raf:Y1"); ace counters have their own defence. */
export function counterOf(typeKey) {
    const t = TYPES[baseId(typeKey)];
    const c = counters[t.side][t.aircraft];
    if (!c) throw new Error(`no counter data for ${t.side} ${t.aircraft}`);
    return t.rank === 'ace' && c.ace ? { ...c, defence: c.ace } : c;
}

/** Printed defence of a marker type when the scenario token does not give one (anti-aircraft artillery). */
export const markerDefence = (type) => counters.markers[type]?.defence ?? null;

export function scenarioById(id) {
    const s = SCENARIOS.find((x) => x.id === Number(id));
    if (!s) throw new Error(`unknown scenario ${id}`);
    return s;
}

export { SCENARIOS };
