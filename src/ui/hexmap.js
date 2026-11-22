// The geometry of the hex board, shared by the game's board (board.js, with the photos) and the companion's own map
// (companion/map.js, without them): where each hex is drawn, facings as angles, the section colours and which hexes
// are land.

import { boardFrom, tileHexes, unkey } from '../engine/hex.js';
import { scenarioById } from '../engine/data.js';
import TERRAIN from '../data/tiles.json' with { type: 'json' };

export const R = 30; // hex circumradius in SVG units
export const center = (k) => {
    const [c, d] = unkey(k);
    return [c * 1.5 * R + R, (d * Math.sqrt(3) * R) / 2 + R];
};
// tileHexes() order of a tile turned 180° → hex of the unturned tile (the column of three reverses, so does the other)
const ROT180 = [2, 1, 0, 4, 3];
export const ANGLE = [-90, -30, 30, 90, 150, 210]; // facing → degrees (SVG, y down)
export const SECTION_COLOR = { Y: '#e3bd3a', R: '#d4574e', G: '#7fae7a', P: '#9a6cc4', B: '#5a93cf', H: '#a9a49a', S: '#c08957' };

/**
 * Land hexes of a scenario: markers with a land and a sea face show the one of their hex (src/data/tiles.json, read
 * off the tile photos; [D-18] the three loose land hexes of scenario 7).
 */
export function landHexes(sc) {
    const land = new Set((sc.landHexes ?? []).map(([c, d]) => `${c},${d}`));
    for (const tile of sc.tiles) {
        tileHexes(tile).forEach((k, i) => {
            if (TERRAIN[tile.id][tile.rot === 180 ? ROT180[i] : i] === 'land') land.add(k);
        });
    }
    return land;
}

/** The board hex under a point in board units, or null off the board. */
export function hexAt(view, x, y) {
    let best = null, near = R;
    for (const k of boardFrom(scenarioById(view.scenario).hexes)) {
        const [cx, cy] = center(k);
        const d = Math.hypot(x - cx, y - cy);
        if (d < near) [best, near] = [k, d];
    }
    return best;
}

