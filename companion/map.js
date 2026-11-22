// The companion's own map (docs/02 §8.1): no photographed tiles, only a diagram drawn from the scenario data. Sea and
// land hex by hex, the letter of each land tile (as printed on the physical one), clouds, barrage balloons, ships,
// structures and anti-aircraft guns as drawn symbols, the deploy and escape hexes. Aircraft are teardrops pointing to
// their facing, as the counters, with their short name and defence; out of action, grey. Every symbol is drawn in SVG,
// never a character of the font (61 §7.9: ★ looked different on every device).
// What answers the pending decision is highlighted and clickable (`data-pick`); `focus` marks what an instruction is
// about, and `arrow` draws an attack.

import { s } from '../src/ui/dom.js';
import { boardFrom, tileHexes } from '../src/engine/hex.js';
import { scenarioById, counterOf, baseId, TYPES } from '../src/engine/data.js';
import { R, center, ANGLE, SECTION_COLOR, landHexes, hexAt } from '../src/ui/hexmap.js';
import { shortLabel, isAce } from './names.js';

const hexPoints = (x, y, r = R) =>
    Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
    }).join(' ');

/** A five-pointed star centred on (cx, cy), `r` from the centre to a point, the top one up. */
export function starPath(cx, cy, r) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? r * 0.42 : r;
        pts.push(`${(cx + k * Math.cos(a)).toFixed(2)} ${(cy + k * Math.sin(a)).toFixed(2)}`);
    }
    return `M${pts.join(' L')} Z`;
}

/** The hex under a point of the map (board units), or null. */
export const hexAtPoint = (view, x, y) => hexAt(view, x, y);

/**
 * @param {any} view the engine's view (or a step's board)
 * @param {{ picks?: Map<string, string>, onPick?: (id: string) => void, focus?: any, arrow?: any[], me?: number,
 *   terrain?: boolean, planes?: boolean }} o
 *   picks: aircraft id, marker id or "hex:<k>" → the option id it answers; terrain: our pixel-art sea and fields
 *   (else flat colours); planes: the aircraft drawn on its counter (else its name only)
 */
export function drawMap(view, { picks = new Map(), onPick, focus = {}, arrow = [], me = 0, terrain = true, planes = false } = {}) {
    const sc = scenarioById(view.scenario);
    const board = boardFrom(sc.hexes);
    const land = landHexes(sc);
    let maxX = 0, maxY = 0;
    const g = s('g');
    const pickable = (el, key) => {
        const pick = picks.get(key);
        if (!pick) return el;
        el.classList.add('pickable');
        el.dataset.pick = pick;
        el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            onPick?.(pick);
        });
        return el;
    };
    const focusHexes = new Set([focus.hex, ...(focus.hexes ?? [])].filter(Boolean));
    for (const k of board) {
        const [x, y] = center(k);
        maxX = Math.max(maxX, x + R);
        maxY = Math.max(maxY, y + R);
        const kind = land.has(k) ? 'land' : 'sea';
        const style = terrain ? `fill: url(#cmp-${kind}-${(hashOf(k) % TEXTURES[kind]) + 1})` : undefined;
        g.append(pickable(s('polygon', { points: hexPoints(x, y), class: `hex ${kind}${focusHexes.has(k) ? ' focus' : ''}`, style }), `hex:${k}`));
    }
    // the letter of each land tile, at the top of its middle hex, to match the table
    for (const tile of sc.tiles) {
        const [x, y] = center(tileHexes(tile)[1]);
        g.append(s('text', { x, y: y - R * 0.55, class: 'tile-id' }, tile.id));
    }
    // the deploy hexes (scenario 9) only while setting up; the start screen shows them too (round 0)
    if (view.phase === 'setup') for (const k of view.deploy ?? []) g.append(s('polygon', { points: hexPoints(...center(k), R * 0.82), class: 'deploy' }));
    for (const [c, d] of sc.escape ?? []) g.append(s('polygon', { points: hexPoints(...center(`${c},${d}`), R * 0.82), class: 'escape' }));
    for (const m of view.markers) if (m.status === 'board') g.append(pickable(markerSvg(m, focus.marker === m.id), m.id));
    // several counters in a hex fan out
    const perHex = {};
    const at = {};
    for (const a of Object.values(view.aircraft)) {
        if (a.status !== 'board' || !a.hex) continue;
        const i = (perHex[a.hex] = (perHex[a.hex] ?? -1) + 1);
        const [cx, cy] = center(a.hex);
        at[a.id] = [cx + i * 10, cy - i * 10];
        if (a.pub) at[a.pub] = at[a.id];
        const el = counterSvg(a, ...at[a.id], focus.aircraft != null && (focus.aircraft === a.id || focus.aircraft === a.pub), me, planes);
        g.append(pickable(el, a.id));
    }
    for (const ar of arrow) {
        const from = at[ar.from] ?? (ar.from.includes(',') ? center(ar.from) : null);
        const to = at[ar.to] ?? (ar.to.includes(',') ? center(ar.to) : null);
        if (!from || !to) continue;
        g.append(s('line', { x1: from[0], y1: from[1], x2: to[0], y2: to[1], class: `arrow ${ar.side}`, 'marker-end': 'url(#cmp-head)' }));
    }
    const defs = s('defs', {}, s('marker', { id: 'cmp-head', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' },
        s('path', { d: 'M0 0 L10 5 L0 10 Z', class: 'arrow-head' })));
    // each texture pixel two map units wide, so the pixel art reads as such (a hex is 60 units across)
    if (terrain) for (const [kind, n] of Object.entries(TEXTURES)) for (let i = 1; i <= n; i++) {
        defs.append(s('pattern', { id: `cmp-${kind}-${i}`, patternUnits: 'userSpaceOnUse', width: 128, height: 128 },
            s('image', { href: `assets/companion/terrain/${kind}-${i}.png`, width: 128, height: 128, class: 'tex' })));
    }
    return s('svg', { viewBox: `-4 -4 ${maxX + 8} ${maxY + 8}`, class: `cmap${terrain ? ' terrain' : ''}` }, defs, g);
}

/** Our textures (tools/companion_art.py): how many of each. */
const TEXTURES = { sea: 3, land: 4 };
/** A hex always gets the same texture. */
function hashOf(k) {
    let h = 0;
    for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
}
// loaded once at the start, so the first map does not show up empty
if (typeof Image !== 'undefined') for (const [kind, n] of Object.entries(TEXTURES)) for (let i = 1; i <= n; i++) new Image().src = `assets/companion/terrain/${kind}-${i}.png`;

/** The picture of an aircraft type seen from above, nose to the right (tools/companion_art.py). */
export const planeArt = (type) => `assets/companion/aircraft/${type.aircraft.toLowerCase().replace(/ /g, '')}.png`;

/**
 * An aircraft: a teardrop to its facing, its section's colour on the rim, its short name and defence upright; with
 * `planes`, the aircraft itself flies inside it towards the tip, and the name and defence sit on its edge.
 */
function counterSvg(a, x, y, focused, me, planes) {
    const type = TYPES[baseId(a.id)];
    const r = R * 0.5;
    const tip = `M ${r * 0.69} ${-r * 0.724} L ${r * 1.5} 0 L ${r * 0.69} ${r * 0.724} A ${r} ${r} 0 1 1 ${r * 0.69} ${-r * 0.724} Z`;
    const label = shortLabel(a);
    const side = a.seat ? 'lw' : 'raf';
    const el = s('g', { class: `ccounter ${side}${a.ready ? '' : ' out'}${a.seat === me ? ' mine' : ''}${focused ? ' focus' : ''}`, 'data-piece': a.id, transform: `translate(${x} ${y})` },
        s('path', { d: tip, transform: `rotate(${ANGLE[a.facing]})`, class: 'body', style: `stroke: ${SECTION_COLOR[type.section] ?? '#999'}` }));
    const def = String(counterOf(a.id).defence);
    if (planes) {
        el.classList.add('art');
        el.append(s('image', { href: planeArt(type), x: -12, y: -12, width: 24, height: 24, transform: `rotate(${ANGLE[a.facing]})`, class: 'plane' }),
            s('text', { x: -9, y: -8, class: 'label' }, label),
            s('text', { x: 10, y: 13, class: 'def' }, def));
        if (isAce(a)) el.append(s('path', { d: starPath(-9 + label.length * 3.4, -11, 3), class: 'star' }));
        return el;
    }
    el.append(s('text', { y: -1, class: 'label' }, label));
    if (isAce(a)) el.append(s('path', { d: starPath(label.length > 1 ? 8 : 6, -5, 3.6), class: 'star' }));
    el.append(s('text', { y: 9.5, class: 'def' }, def));
    return el;
}

/** Markers as drawn symbols, with the defence a bomber needs where it has one. */
function markerSvg(m, focused) {
    const [x, y] = center(m.hex);
    const el = s('g', { class: `cmarker ${m.type}${focused ? ' focus' : ''}`, 'data-piece': m.id, transform: `translate(${x} ${y})` });
    switch (m.type) {
        case 'cloud':
            for (const [cx, cy, r] of [[-9, 4, 8], [0, -2, 11], [10, 4, 8], [0, 7, 9]]) el.append(s('circle', { cx, cy, r }));
            break;
        case 'balloon':
            el.append(s('line', { x1: 0, y1: 4, x2: 0, y2: 20, class: 'cable' }), s('ellipse', { cx: 0, cy: -6, rx: 13, ry: 9 }), s('path', { d: 'M 11 -6 L 18 -11 L 18 -1 Z' }));
            break;
        case 'ship':
            el.append(s('path', { d: 'M 0 -20 L 7 -8 L 7 16 L -7 16 L -7 -8 Z', transform: `rotate(${ANGLE[m.facing ?? 0] + 90})` }));
            break;
        case 'structure':
            el.append(s('path', { d: 'M -14 12 L -14 -4 L -6 -10 L 2 -4 L 2 -10 L 14 -10 L 14 12 Z' }));
            break;
        case 'aaa':
            el.append(s('circle', { cx: 0, cy: 0, r: 12 }), s('path', { d: 'M -16 0 L 16 0 M 0 -16 L 0 16', class: 'cross' }));
            break;
        default:
            el.append(s('circle', { cx: 0, cy: 0, r: 10 }));
    }
    if (m.defence != null && m.type !== 'cloud' && m.type !== 'balloon') {
        el.append(s('circle', { cx: 15, cy: -15, r: 8, class: 'mdef-bg' }), s('text', { x: 15, y: -11.5, class: 'mdef' }, String(m.defence)));
    }
    return el;
}
