// Combat actions (docs/01 §8): Attack, Anti-Air and Bomb. Target lists carry everything the UI and bots need
// (total defence, dice, rear) so they can be shown before choosing.

import { log, beat, choose } from './ask.js';
import { TYPES, baseId } from './data.js';
import { REL, line, turn, distance } from './hex.js';
import { nextRandom } from './rng.js';
import {
    boardOf, counter, hit, neutralise, onBoard, checkWin, unpub, pub, decoyOf, removeDecoy, BOMBABLE, grounded, isExternal, casualtyFrom, settlePurge,
} from './state.js';

const d10 = (g) => 1 + Math.floor(nextRandom(g) * 10);

/** Chance that at least one of `dice` d10 reaches `total` (docs/01 §8.4). */
export const hitChance = (total, dice) => (total > 10 ? 0 : 1 - ((total - 1) / 10) ** dice);

/** [D-1] errata: the firing line in direction `dir` enters the target through one of its three rear edges. */
export const isRear = (dir, targetFacing) => [turn(targetFacing, -1), targetFacing, turn(targetFacing, 1)].includes(dir);

/**
 * Enemy aircraft in a's firing lines, with their total defence (docs/01 §8.1–8.3). Grounded RAF aircraft
 * (out of action) cannot be attacked; suppressed Luftwaffe aircraft can.
 * @param {{ value: number, rear?: number }} action
 */
export function attackTargets(g, a, action) {
    const board = boardOf(g);
    const planes = onBoard(g);
    const at = new Map(); // hex -> the aircraft on it, in the order of g.aircraft
    for (const t of planes) at.set(t.hex, [...(at.get(t.hex) ?? []), t]);
    const best = new Map();
    for (const rel of counter(a).lines) {
        const dir = turn(a.facing, REL[rel]);
        const path = line(board, a.hex, dir);
        path.forEach((hex, range) => {
            for (const t of at.get(hex) ?? []) {
                if (t.seat === a.seat) continue;
                if (grounded(t)) continue;
                const cover = coverBonus(g, path.slice(0, range + 1), a, t, at);
                const rear = range > 0 && isRear(dir, t.facing);
                const total = counter(t).defence + cover + range;
                const dice = rear && action.rear ? action.rear : action.value;
                const opt = { target: t.id, dir, range, cover, total, rear, dice };
                const prev = best.get(t.id);
                if (!prev || opt.dice > prev.dice || (opt.dice === prev.dice && opt.total < prev.total)) best.set(t.id, opt);
            }
        });
    }
    return [...best.values()];
}

/** +1 per other aircraft and +2 per cloud on the path (both ends included), +2 per balloon (docs/01 §8.2, [D-3]). */
function coverBonus(g, path, a, t, at) {
    let cover = 0;
    for (const hex of path) {
        cover += (at?.get(hex) ?? onBoard(g).filter((x) => x.hex === hex)).filter((x) => x !== a && x !== t).length;
        for (const m of g.markers) {
            if (m.status !== 'board' || m.hex !== hex) continue;
            if (m.type === 'cloud' || m.type === 'balloon') cover += 2;
        }
    }
    return cover;
}

/** Anti-Air: any enemy aircraft; range from the closest anti-aircraft artillery marker ([D-4]: none, no action). */
export function antiAirTargets(g, seat, action) {
    const guns = g.markers.filter((m) => m.type === 'aaa' && m.status === 'board');
    if (!guns.length) return [];
    return onBoard(g)
        .filter((t) => t.seat !== seat)
        .map((t) => {
            const range = Math.min(...guns.map((m) => distance(m.hex, t.hex)));
            return { target: t.id, range, cover: 0, total: counter(t).defence + range, rear: false, dice: action.value };
        });
}

/** Bomb: ship, structure, AAA marker or grounded RAF aircraft in the bomber's hex. */
export function bombTargets(g, a, action) {
    const out = [];
    for (const m of g.markers) {
        if (m.status !== 'board' || m.hex !== a.hex || !BOMBABLE.includes(m.type)) continue;
        out.push({ target: m.id, range: 0, cover: 0, total: m.defence ?? 10, rear: false, dice: action.value });
    }
    for (const t of onBoard(g)) {
        if (t.seat !== a.seat && grounded(t) && t.hex === a.hex) {
            out.push({ target: t.id, range: 0, cover: 0, total: counter(t).defence, rear: false, dice: action.value });
        }
    }
    return out;
}

/**
 * The dice of a combat action by `seat`: rolled by the engine, or by the companion's player (their own dice, and the
 * bot's when setup.botDice is 'physical'), who says hit or miss, with the breakdown of the number. { dice: null } then.
 * Above 10 nothing can hit: no dice, no question.
 */
function* rollFor(g, seat, type, opt, by) {
    const ext = g.setup.external;
    if (opt.total > 10 || ext == null || (seat !== ext && g.setup.botDice !== 'physical')) {
        const dice = opt.total > 10 ? [] : Array.from({ length: opt.dice }, () => d10(g));
        return { dice, success: dice.some((v) => v >= opt.total) };
    }
    const defence = opt.total - opt.cover - opt.range;
    const a = yield* choose(g, ext, 'roll', [{ id: 'hit' }, { id: 'miss' }], {
        attacker: seat, type, by: by && pub(g, by), target: opt.target, dice: opt.dice, total: opt.total, defence, cover: opt.cover, range: opt.range, rear: opt.rear,
    });
    return { dice: null, success: a === 'hit' };
}

/** A hit that costs a card: an external seat says where it takes the card from (its decoy goes first). */
function* takeHit(g, plane) {
    if (plane.decoy || !isExternal(g, plane.seat)) return hit(g, plane);
    const twin = decoyOf(g, plane);
    if (twin) removeDecoy(g, twin, 'paired');
    const from = casualtyFrom(g, plane);
    if (!from.length) return hit(g, plane);
    const a = yield* choose(g, plane.seat, 'casualty', from.map((w) => ({ id: `from:${w}`, from: w })), { aircraft: plane.id });
    hit(g, plane, a.slice(5));
}

/** Roll and apply one combat action against an option from the lists above. */
export function* resolve(g, seat, type, opt, by) {
    const { dice, success } = yield* rollFor(g, seat, type, opt, by);
    log(g, 'combat', { seat, type, by, target: opt.target, total: opt.total, rear: opt.rear, range: opt.range, cover: opt.cover, dice, success });
    yield* beat(g, 'combat', { seat, type, by, target: opt.target, dice, success, total: opt.total });
    if (!success) return;
    const plane = g.aircraft[unpub(g, opt.target)];
    if (type === 'attack') {
        yield* takeHit(g, plane);
        yield* settlePurge(g);
    } else if (type === 'antiAir') {
        // [D-19]: a successful Anti-Air also reveals a decoy, and removes the decoy of a real aircraft first
        if (plane.decoy) return removeDecoy(g, plane, 'revealed');
        const twin = decoyOf(g, plane);
        if (twin) removeDecoy(g, twin, 'paired');
        if (plane.ready) {
            plane.ready = false;
            log(g, 'suppressed', { seat: plane.seat, aircraft: plane.id });
        }
    } else if (plane) {
        neutralise(g, plane, 'bomb');
        yield* settlePurge(g);
    }
    else {
        const m = g.markers.find((x) => x.id === opt.target);
        m.status = 'destroyed';
        log(g, 'destroyed', { seat, marker: m.id, type: m.type });
        checkWin(g);
    }
}

export const isBomber = (typeKey) => TYPES[baseId(typeKey)].actions.some((x) => x.type === 'bomb');
