// The first heuristic bot, kept as the arena baseline (`node tools/arena.mjs --duel heuristic,greedy`). Greedy and
// view only (docs/02 §6): it flies step by step towards the enemy, turns to put targets on its firing lines, shoots
// at the best chance to hit, keeps Discord cards for bidding and bolsters its aircraft.

import { TYPES, scenarioById, baseId } from '../engine/data.js';
import { attackTargets, bombTargets, hitChance } from '../engine/combat.js';
import { step, turn, distance, key } from '../engine/hex.js';
import { boardOf, mayEscape, escapeOpen, grounded, BOMBABLE } from '../engine/state.js';
import { seedFrom, nextRandom } from '../engine/rng.js';
import { makePick, withAircraft } from './common.js';

export function greedyBot(seed = 'h') {
    const r = { rng: seedFrom(seed) };
    const pick = makePick(r);
    return (req, view) => {
        const me = req.seat;
        const enemies = Object.values(view.aircraft).filter((a) => a.seat !== me && a.status === 'board');
        const card = (key) => TYPES[key];
        switch (req.kind) {
            case 'bid': // Discord first, otherwise the lowest initiative card
                return pick(req.options, (o) => -o.initiative + (card(o.card).kind === 'discord' ? 20 : 0));
            case 'play':
                return pick(req.options, (o) => {
                    if (o.id === 'end') return 0;
                    const c = card(o.card);
                    if (c.kind === 'combat') return 5 + c.initiative / 10 + attackValue(view, `${c.side}:${c.id}`, me);
                    if (c.id === 'sqn' || c.id.startsWith('comms')) return 3;
                    return 2;
                });
            case 'plan': {
                const a = view.aircraft[req.aircraft];
                const now = bestShot(view, a);
                return pick(req.options, (o) => ({ actFirst: now + 0.05, moveThenAct: 0.5, manoeuvre: 0.6, move: 0.1 })[o.id] ?? 0);
            }
            case 'move': {
                const a = view.aircraft[req.aircraft];
                const board = boardOf(view);
                return pick(req.options, (o) => {
                    if (o.id === 'escape') return 100;
                    const ghost = { ...a };
                    if (o.id === 'fwd') ghost.hex = step(a.hex, a.facing);
                    if (o.id === 'left' || o.id === 'right') ghost.facing = turn(a.facing, o.id === 'left' ? -1 : 1);
                    if (!board.has(ghost.hex)) return -5;
                    const ahead = step(ghost.hex, ghost.facing);
                    const edgePenalty = board.has(ahead) ? 0 : -0.3;
                    const shot = bestShot(withAircraft(view, a.id, ghost), ghost);
                    const near = enemies.length ? Math.min(...enemies.map((e) => distance(e.hex, ghost.hex))) : 0;
                    const toward = enemies.length ? Math.min(...enemies.map((e) => distance(e.hex, ahead))) - near : 0;
                    const goal = goalPull(view, a, ghost);
                    const w = goal == null ? 1 : 0.3; // bombers and escapers care more about their goal than about fighters
                    return shot * 3 + w * (-near * 0.05 - toward * 0.1) + (goal ?? 0) + edgePenalty + (o.id === 'stop' ? 0.02 : 0);
                });
            }
            case 'combat':
                return pick(req.options, (o) => (o.id === 'none' ? 0 : hitChance(o.total, o.dice) + (o.type === 'bomb' ? 0.2 : 0)));
            case 'comms': {
                const hand = view.players[me].hand ?? [];
                const discords = hand.filter((c) => c.includes(':discord:')).length;
                const prefer = { bolster: 3, coordinate: discords ? 4 : 0, command: 2, inspire: 2.5, guide: 1, 'anti-air': 3.5, sail: 3 };
                return pick(req.options, (o) => (o.id === 'dark' ? 0.5 : (prefer[o.action] ?? 1) - (o.discord ? 1.5 : 0)));
            }
            case 'bolster':
                return pick(req.options, (o) => (o.id === 'done' ? 0 : card(o.card).kind === 'combat' ? 2 : card(o.card).kind === 'discord' ? -1 : 1));
            case 'command':
                return 'draw';
            case 'inspire':
                return pick(req.options, (o) => attackValue(view, o.card, me));
            case 'guide':
                return req.options[Math.floor(nextRandom(r) * req.options.length)].id;
            case 'sail':
                return pick(req.options, (o) => (o.id === 'done' ? 0 : 1));
            default:
                return req.options[Math.floor(nextRandom(r) * req.options.length)].id;
        }
    };
}

/**
 * Pull towards the aircraft's own goal: bombers towards the nearest marker they can bomb, escapers towards the
 * nearest escape hex (counting the hex ahead, so it learns to face the goal). null if it has none.
 */
function goalPull(view, a, ghost) {
    const s = scenarioById(view.scenario);
    const t = TYPES[baseId(a.id)];
    const goals = [];
    if (mayEscape(view, a) && escapeOpen(view, a.seat)) goals.push(...(s.escape ?? []).map(([c, d]) => key(c, d)));
    if (t.actions.some((x) => x.type === 'bomb')) {
        for (const m of view.markers) if (m.status === 'board' && BOMBABLE.includes(m.type)) goals.push(m.hex);
        for (const e of Object.values(view.aircraft)) if (e.seat !== a.seat && e.status === 'board' && grounded(e)) goals.push(e.hex);
    }
    if (!goals.length) return null;
    const board = boardOf(view);
    const ahead = step(ghost.hex, ghost.facing);
    const d = Math.min(...goals.map((k) => distance(k, ghost.hex)));
    const dAhead = board.has(ahead) ? Math.min(...goals.map((k) => distance(k, ahead))) : d + 1;
    return -d * 0.4 - (dAhead - d) * 0.15 + (d === 0 ? 1 : 0);
}

/** Best hit chance the aircraft has right now with its attack / bomb values. */
function bestShot(view, a) {
    if (!a || a.status !== 'board' || !a.ready || a.decoy) return 0;
    const t = TYPES[baseId(a.id)];
    let best = 0;
    for (const act of t.actions) {
        const opts = act.type === 'attack' ? attackTargets(view, a, act) : act.type === 'bomb' ? bombTargets(view, a, act) : [];
        for (const o of opts) best = Math.max(best, hitChance(o.total, o.dice) + (act.type === 'bomb' ? 0.2 : 0));
    }
    return best;
}

function attackValue(view, key, me) {
    const a = view.aircraft[key];
    return a && a.seat === me ? bestShot(view, a) : 0;
}
