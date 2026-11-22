// Flat-top hexes in doubled coordinates (docs/01 §2.2): a hex is (c, d) with c + d even, c grows to the east and
// d to the south in half rows. Directions are 0..5 clockwise from north and double as facings.

export const DIRS = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];
const DELTA = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]];

/** Firing lines on a counter, relative to the nose. */
export const REL = { F: 0, FR: 1, BR: 2, B: 3, BL: 4, FL: 5 };

export const key = (c, d) => `${c},${d}`;

// the bots ask for the same few hundred hexes millions of times: coordinates and neighbours are worked out once
const COORDS = new Map();
const NEIGHBOURS = new Map();

/** @param {string} k @returns {readonly [number, number]} (shared: do not change it) */
export function unkey(k) {
    let cd = COORDS.get(k);
    if (!cd) COORDS.set(k, (cd = Object.freeze(k.split(',').map(Number))));
    return /** @type {[number, number]} */ (cd);
}

/** @param {number} dir */
export const turn = (dir, by) => (((dir + by) % 6) + 6) % 6;

/** @returns {string} the hex one step from `k` in direction `dir` */
export function step(k, dir) {
    let around = NEIGHBOURS.get(k);
    if (!around) {
        const [c, d] = unkey(k);
        NEIGHBOURS.set(k, (around = DELTA.map(([dc, dd]) => key(c + dc, d + dd))));
    }
    return around[dir];
}

export function distance(a, b) {
    const [c1, d1] = unkey(a);
    const [c2, d2] = unkey(b);
    const dc = Math.abs(c1 - c2);
    const dd = Math.abs(d1 - d2);
    return dc + Math.max(0, (dd - dc) / 2);
}

/**
 * The hexes of a straight line from `from` in direction `dir`, starting with `from` itself, until it leaves `board`.
 * @param {Set<string>} board
 */
export function line(board, from, dir) {
    const out = [from];
    for (let k = step(from, dir); board.has(k); k = step(k, dir)) out.push(k);
    return out;
}

/** Board hexes from a scenario's { c: "dmin-dmax[,a-b]" } map. */
export function boardFrom(hexes) {
    const out = new Set();
    for (const [c, spec] of Object.entries(hexes)) {
        for (const part of spec.split(',')) {
            const [a, b = a] = part.split('-').map(Number);
            for (let d = a; d <= b; d += 2) out.add(key(Number(c), d));
        }
    }
    return out;
}

/** The 5 hexes of a land tile (docs/01 §2.2). */
export function tileHexes({ hex: [c, d], rot = 0 }) {
    const side = rot === 0 ? 1 : -1;
    return [key(c, d), key(c, d + 2), key(c, d + 4), key(c + side, d + 1), key(c + side, d + 3)];
}

/** A hex on the edge: some neighbour is off the board. */
export const onEdge = (board, k) => DELTA.some((_, dir) => !board.has(step(k, dir)));
