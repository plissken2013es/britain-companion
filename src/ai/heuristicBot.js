// Bot that only uses its view (docs/02 §6). It plans the whole flight of every combat card — plan, path and action
// — and scores where the aircraft ends up: the shot it takes now, the shots the enemy could take at it before it
// moves again (from where each enemy aircraft can be after a straight move), the shots it will have next time, the
// scenario goal (bomb targets, escape hexes, the aircraft its objective singles out), the board edge, barrage
// balloons and its section mate. Shots are worth more against the aircraft and markers its objective counts and
// against aircraft already hit. The bid keeps a Discord it can Coordinate away, the cards its objective depends on
// and the card of a grounded aircraft, and otherwise gives the card worth least this round. Bolster takes the cards
// of the aircraft in most need. Every number that weighs a choice is in W, BID, PLAY, COMMS, BOLSTER or WORTH below,
// exported so the arena can try them. The first greedy bot is ./greedyBot.js.

import { TYPES, SIDES, scenarioById, baseId, nameToType, typeOf } from '../engine/data.js';
import { attackTargets, bombTargets, hitChance } from '../engine/combat.js';
import { step, turn, distance, key, line } from '../engine/hex.js';
import { boardOf, outOfComms, matches, weightOf, mayEscape, escapeOpen, sectionOf, grounded } from '../engine/state.js';
import { seedFrom, nextRandom } from '../engine/rng.js';
import { makePick, withAircraft } from './common.js';

/** Where a flight ends. */
export const W = {
    edge: 1.2, // the Discord card for flying off the board
    facingEdge: 1.5, // next flight starts towards the edge: it will bump it (a Discord) to turn round
    facingExit: 0.3, // the same on an escape hex, for an aircraft that may escape now: the edge is the way out
    nearEdge: 0.6, // one hex from the edge facing it: next flight has one hex left before bumping
    facingBalloon: 4, // next flight starts into a barrage balloon (only aces can turn first)
    dead: 10, // flying into a barrage balloon: the aircraft is neutralised
    escaped: 6, // escaping when escapes count
    strayEscape: -2, // escaping when they do not (no scenario has it)
    danger: 1, // per expected hit taken
    dangerCards: 3, // each enemy aircraft acts with a share of this many cards over the aircraft of its side
    deployLuck: 2, // random part of the deploy hex score (scenario 9)
    next: 0.4, // shots available next time
    approach: 0.05, // per hex closer to the nearest enemy, for an aircraft with no goal or prey to pull it
    wingman: 0.1, // per hex beyond 1 from the other aircraft of the section (out of comms: Discord)
    wingmanMax: 4, // hexes beyond 1 counted at most
    focus: 0.15, // extra worth of a hit per card the target has already lost
    playBias: 0.3, // a card left in hand is lost at the end of the turn
    takeOff: 3, // the card of a grounded RAF aircraft (scenarios 7, 9 and 11), in the bid and in play
    suppressed: 0.5, // the card of a suppressed Luftwaffe aircraft: it only readies it
    hunt: 0.4, // per hex closer to the nearest enemy aircraft my objective singles out (the Stukas of scenario 2)
    huntFacing: 0.2, // and facing it
    bomb: 0.4, // per hex closer to the nearest marker or grounded aircraft a bomber should bomb
    bombFacing: 0.15, // and facing it
    onTarget: 1, // on the hex of its bomb target or on an escape hex
    escape: 0.8, // per hex from the nearest escape hex, for an aircraft that may escape now
    escapeFacing: 0.3, // per hex two straight moves bring it closer (flying diagonally to a straight edge does not)
    mend: 1.5, // Bolster: extra worth of a card of an aircraft on the board, × its worth / (1 + the cards it has left)
    mendComms: 0.75, // and of Bolster itself, for the aircraft in most need it can take a card for
    shipAway: 1, // a ship the enemy scores sails: per hex further from the nearest enemy bomber (scenario 11)
    shipOut: 2, // and off the board, where it can no longer be bombed
    shipOn: 0.1, // a ship sailing the same distance from them: on towards the edge
};

/**
 * The bid: a Discord that can be Coordinated, and the card that would do it, are kept like a good card (keep; with no
 * Discord in hand the cards that Coordinate are kept too: keeping them only with a Discord won 43 % in scenario 5 and
 * 55 % in 9 against this, 2026-11-22); so is
 * the card of an aircraft the objective depends on (goal: the Stukas that must sink the ships of scenario 2), and the
 * Ships card when getting ships out wins (sail: in scenario 6 its initiative of 2 made it the RAF bot's usual bid, so
 * it sailed in 15 % of the rounds). Otherwise a Discord goes first (discord), then the card worth least this round,
 * a comms card counting as worth `comms`; the initiative, divided by `initiative`, leans to the lowest.
 */
export const BID = { keep: -2, goal: 3, sail: 3, discord: 20, comms: 0.5, initiative: 10 };

/** Which card to play next: a combat card by what its flight gains (over `combat`), a comms card, anything else. */
export const PLAY = { combat: 2, comms: 1.5, other: 1 };

/**
 * Which action of a comms card: fixed worths by action (Bolster also by what it can take, Coordinate only offered with
 * a Discord in hand), less `discordIcon` when the action costs a Discord; `dark` to play none.
 */
export const COMMS = { bolster: 3, coordinate: 4, command: 2, inspire: 2.5, guide: 1.5, 'anti-air': 3.5, sail: 3, other: 1, comms: 1, dark: 0.5, discordIcon: 1.5 };

/** Which card to take with Bolster: a combat card (plus what it mends), anything else. */
export const BOLSTER = { combat: 2, other: 1 };

/** What hits and losses are worth. */
export const WORTH = {
    aircraft: 0.8, // a hit on any enemy aircraft: even when the objective is elsewhere, it protects your own
    singled: 2, // on an aircraft a neutralise objective singles out (units, aircraft type or rank), × its weight
    counted: 1.5, // on an aircraft a neutralise objective counts, × its weight
    points: 1.2, // × the points a neutralised aircraft gives
    marker: 0.3, // a hit on a marker the objective does not count
    destroy: 3, // on a marker a destroy objective counts
    markerPoints: 2, // × the points a destroyed marker gives
    bombGrounded: 2.5, // a bomb on a grounded aircraft neutralises it outright
    antiAir: 0.5, // anti-air suppresses, it does not hit
    needed: 1.5, // a card lost by an aircraft my objective needs (bombers, escapers)
    targeted: 1.3, // and by one the enemy objective singles out
};

export function heuristicBot(seed = 'h') {
    const r = { rng: seedFrom(seed) };
    const pick = makePick(r);
    return (req, view) => {
        const me = req.seat;
        const ctx = context(view, me);
        switch (req.kind) {
            case 'bid': {
                // as in 61_Undaunted_Normandy (the Fog of War kept for Recon): a Discord is kept while the hand has a card
                // that can Coordinate it away for good, and so is that card (bidding the Discord only cycles it)
                const types = (view.players[me].hand ?? []).map(typeOf);
                const coordinates = (t) => t.actions.some((x) => x.type === 'coordinate' && (x.icon !== 'blocked' || !outOfComms(view, me, t.section)));
                const keep = types.filter((t) => t.kind === 'discord').length <= types.filter(coordinates).length;
                return pick(req.options, (o) => {
                    const c = TYPES[o.card];
                    if (keep && (c.kind === 'discord' || coordinates(c))) return BID.keep - o.initiative / BID.initiative;
                    if (c.kind === 'discord') return BID.discord;
                    if (c.kind !== 'combat') return -o.initiative / BID.initiative - BID.comms - (c.actions.some((x) => x.type === 'sail') && ctx.conds.some((x) => x.escape != null && x.what === 'ship') ? BID.sail : 0);
                    return -o.initiative / BID.initiative - Math.max(0, cardScore(ctx, o.card)) - (keepForGoal(ctx, view.aircraft[baseId(o.card)]) ? BID.goal : 0);
                });
            }
            case 'play':
                return pick(req.options, (o) => {
                    if (o.id === 'end') return 0;
                    const c = TYPES[o.card];
                    if (c.kind === 'combat') return PLAY.combat + cardScore(ctx, o.card);
                    if (c.actions.some((x) => x.type === 'coordinate')) return PLAY.comms; // Squadron or Section Comms
                    return PLAY.other;
                });
            case 'plan':
                return bestPlan(ctx, req.aircraft, req.card, req.options).plan;
            case 'move': {
                const a = view.aircraft[req.aircraft];
                const ids = req.options.map((o) => o.id);
                const state = { hex: a.hex, facing: a.facing, moved: req.moved, turns: req.turns, turnedLast: req.turnedLast, pre: req.pre };
                const best = bestFlight(ctx, a, req.max, state, req.act);
                // bestFlight mirrors moveAircraft; if they ever disagree, any offered step (fallbacks counts it)
                if (ids.includes(best.first)) return best.first;
                fallbacks.move++;
                return pick(req.options, () => 0);
            }
            case 'edge': {
                const a = view.aircraft[req.aircraft];
                return pick(req.options, (o) => endScore(ctx, a, { hex: a.hex, facing: turn(a.facing, o.id === 'left' ? -1 : 1) }, 'stop', false));
            }
            case 'combat':
                return pick(req.options, (o) => (o.id === 'none' ? 0 : shotValue(ctx, o)));
            case 'comms': {
                // Bolster is worth what it can take: aircraft cards, or comms cards a little ([D-22]: never a Discord)
                const supply = (view.players[me].supply ?? []).map(typeOf);
                const bolster = (o) => {
                    const can = supply.filter((t) => t.kind !== 'discord' && (!o.section || t.section === o.section));
                    const most = Math.max(0, ...can.filter((t) => t.kind === 'combat').map((t) => need(ctx, t.key)));
                    return can.some((t) => t.kind === 'combat') ? COMMS.bolster + W.mendComms * most : COMMS.comms;
                };
                return pick(req.options, (o) => (o.id === 'dark' ? COMMS.dark : (o.action === 'bolster' ? bolster(o) : o.action === 'anti-air' && !foesOnBoard(view, me).some((e) => e.ready) ? 0 : COMMS[o.action] ?? COMMS.other) - (o.discord ? COMMS.discordIcon : 0)));
            }
            case 'bolster': // never a Discord ([D-22])
                return pick(req.options, (o) => (o.id === 'done' ? 0 : TYPES[o.card].kind === 'combat' ? BOLSTER.combat + W.mend * need(ctx, o.card) : BOLSTER.other));
            case 'command':
                return 'draw';
            case 'inspire':
                return pick(req.options, (o) => cardScore(ctx, o.card));
            case 'guide': // one hex forward, then a turn if it helps
                return pick(req.options, (o) => {
                    const a = view.aircraft[o.aircraft];
                    const ahead = step(a.hex, a.facing);
                    const here = endScore(ctx, a, a, 'stop', false);
                    // the engine's advance: at the edge it turns left or right and takes a Discord; into a balloon it is lost
                    if (!ctx.board.has(ahead)) return -W.edge + Math.max(...[-1, 1].map((t) => endScore(ctx, a, { hex: a.hex, facing: turn(a.facing, t) }, 'stop', false))) - here;
                    if (ctx.balloons.has(ahead)) return -W.dead - here;
                    return Math.max(...[-1, 0, 1].map((t) => endScore(ctx, a, { hex: ahead, facing: turn(a.facing, t) }, 'stop', false))) - here;
                });
            case 'guideTurn': {
                const a = view.aircraft[req.aircraft];
                return pick(req.options, (o) => endScore(ctx, a, { hex: a.hex, facing: o.id === 'none' ? a.facing : turn(a.facing, o.id === 'left' ? -1 : 1) }, 'stop', false));
            }
            case 'sail':
                return pick(req.options, (o) => (o.id === 'done' ? 0 : sailGain(ctx, view.markers.find((m) => m.id === o.marker))));
            case 'deploy': { // scenario 9: the hex whose best facing ends a flight best (the scenario goal, the edge, the danger),
                // with some chance in it, so that the hexes do not tell the aircraft from its decoy
                const a = { ...view.aircraft[req.aircraft], status: 'board' };
                return pick(req.options, (o) => W.deployLuck * nextRandom(r) + Math.max(...[0, 1, 2, 3, 4, 5].map((f) => endScore(ctx, a, { hex: o.hex, facing: f }, 'stop', false))));
            }
            case 'facing': {
                const a = { ...view.aircraft[req.aircraft], status: 'board' };
                return pick(req.options, (o) => endScore(ctx, a, { hex: a.hex, facing: Number(o.id.slice(2)) }, 'stop', false));
            }
            default:
                return req.options[Math.floor(nextRandom(r) * req.options.length)].id;
        }
    };
}

/** Times a bot answered with a fallback because its model of the engine missed (tests check it stays 0). */
export const fallbacks = { move: 0 };

// ------------------------------------------------------------------ what the side is after

function context(view, me) {
    const s = scenarioById(view.scenario);
    const conds = flat(s.win?.[SIDES[me]] ?? []);
    const foeConds = flat(s.win?.[SIDES[1 - me]] ?? []);
    const hits = {}; // cards each aircraft has lost (public: the log), to finish off the damaged ones
    for (const e of view.log) if (e.k === 'hit') hits[e.aircraft] = (hits[e.aircraft] ?? 0) + 1;
    // cards each of my card types still has in play (hand, deck, discard, play): the scenario's table less what is
    // in the supply and what hits removed; an aircraft with none left is neutralised by the next hit
    const life = {};
    for (const [name, where] of Object.entries(s.cards?.[SIDES[me]] ?? {})) life[`${SIDES[me]}:${nameToType(SIDES[me], name)}`] = where.length;
    const p = view.players[me];
    for (const c of [...(p.supply ?? []), ...(p.removed ?? [])]) {
        const k = typeOf(c).key;
        if (k in life) life[k]--;
    }
    // aircraft statuses do not change inside the flights a request scores, so these hold for the whole request
    const open = escapeOpen(view, me); // scenario 8: "neutralise two, then escape"
    const exits = new Set((s.escape ?? []).map(([c, d]) => key(c, d)));
    const balloons = new Set(view.markers.filter((m) => m.type === 'balloon' && m.status === 'board').map((m) => m.hex));
    return { view, me, s, board: boardOf(view), conds, foeConds, hits, life, open, exits, balloons };
}

const flat = (conds) => conds.flatMap((c) => (c.all ? flat(c.all) : [c]));

const has = (a, type) => TYPES[baseId(a.id)].actions.some((x) => x.type === type);
const foesOnBoard = (view, seat) => Object.values(view.aircraft).filter((e) => e.seat !== seat && e.status === 'board');

/** How much a hit on enemy aircraft `id` is worth to a side with objectives `conds`. */
function aircraftWorth(conds, id, seat) {
    let w = WORTH.aircraft;
    for (const c of conds) {
        if (c.neutralise != null && matches({ id, seat }, c)) w = Math.max(w, (c.units || c.aircraft || c.rank ? WORTH.singled : WORTH.counted) * weightOf(c, id));
        if (c.points != null && c.per?.aircraft) w = Math.max(w, WORTH.points * c.per.aircraft);
    }
    return w;
}

function markerWorth(conds, type) {
    let w = WORTH.marker;
    for (const c of conds) {
        if (c.destroy != null && (!c.what || c.what.includes(type))) w = Math.max(w, WORTH.destroy);
        if (c.points != null && c.per?.[type]) w = Math.max(w, WORTH.markerPoints * c.per[type]);
    }
    return w;
}

/**
 * What sailing ship `m` one hex ahead is worth (against stopping, 0). When getting ships out counts for me (scenario
 * 6) every ship sails. When the enemy scores ships (scenario 11, where they sail north towards the bombers coming
 * in), a ship sails only away from the nearest enemy bomber, or off the board. In the user's game of 2026-11-22 the
 * bot sailed a ship into the hex of the Bf 110 that sank it next turn without moving.
 */
function sailGain(ctx, m) {
    if (ctx.conds.some((c) => c.escape != null && c.what === 'ship')) return 1;
    if (!ctx.foeConds.some((c) => (c.destroy != null && (!c.what || c.what.includes('ship'))) || c.per?.ship)) return 1;
    const next = step(m.hex, m.facing);
    if (!ctx.board.has(next)) return W.shipOut;
    const bombers = foesOnBoard(ctx.view, ctx.me).filter((e) => has(e, 'bomb'));
    if (!bombers.length) return 1;
    const near = (hex) => Math.min(...bombers.map((e) => distance(hex, e.hex)));
    const gain = near(next) - near(m.hex);
    return gain ? W.shipAway * gain : W.shipOn;
}

/** May aircraft `a` of mine leave by the escape hexes now? */
const escaping = (ctx, a) => ctx.open && mayEscape(ctx.view, a);

/**
 * Whether my objective needs aircraft `a` in particular: a bomber when it is to destroy (or score) ships or
 * structures, an aircraft that may escape when escaping counts.
 */
function needed(ctx, a) {
    if (has(a, 'bomb') && ctx.conds.some((c) => c.destroy != null || c.per?.ship || c.per?.structure)) return true;
    return mayEscape(ctx.view, a) && ctx.conds.some((c) => c.escape != null || c.per?.escaped);
}

/**
 * Not to be bid: an aircraft on the board that my objective needs, while others are not needed (in scenario 8 every
 * aircraft may escape, and then none is kept over the rest).
 */
function keepForGoal(ctx, a) {
    if (!a || a.status !== 'board' || a.decoy || !needed(ctx, a)) return false;
    return Object.values(ctx.view.aircraft).some((x) => x.seat === ctx.me && x.status === 'board' && !x.decoy && !needed(ctx, x));
}

/**
 * How much a card of type `key` would mend: for an aircraft of mine on the board, what it is worth over (1 + the
 * cards it has left), so the ace with none left (one hit from losing scenario 5) comes first. What it is worth: as
 * in ownWorth, or more if the enemy wins by neutralising it and few others (1 + 1/n: the ace alone, 2; one of three, 1.33).
 * 0 for anything else.
 */
function need(ctx, key) {
    const a = ctx.view.aircraft[baseId(key)];
    if (!a || a.seat !== ctx.me || a.status !== 'board' || a.decoy || !(key in ctx.life)) return 0;
    let worth = ownWorth(ctx, a);
    for (const c of ctx.foeConds) if (c.neutralise > 0 && matches(a, c)) worth = Math.max(worth, 1 + 1 / c.neutralise);
    return worth / (1 + Math.max(0, ctx.life[key]));
}

/**
 * What losing a card of my aircraft costs: more for the aircraft my objective needs (bombers, escapers). A decoy is
 * scored like its aircraft, so that the way it deploys and flies does not tell the RAF which counter it is.
 */
function ownWorth(ctx, a) {
    const w = needed(ctx, a) ? WORTH.needed : 1;
    return w * (ctx.foeConds.some((c) => c.neutralise != null && matches(a, c) && (c.units || c.aircraft || c.rank)) ? WORTH.targeted : 1);
}

/** Expected value of a combat option (attack, bomb or anti-air) for the side to play. */
function shotValue(ctx, o) {
    const p = hitChance(o.total, o.dice);
    const marker = ctx.view.markers.find((m) => m.id === o.target);
    if (marker) return p * markerWorth(ctx.conds, marker.type);
    const worth = aircraftWorth(ctx.conds, o.target, 1 - ctx.me) * (1 + W.focus * (ctx.hits[o.target] ?? 0));
    if (o.type === 'bomb') return p * worth * WORTH.bombGrounded;
    if (o.type === 'antiAir') return ctx.view.aircraft[o.target]?.ready ? p * worth * WORTH.antiAir : 0; // a suppressed one: no effect
    return p * worth;
}

// ------------------------------------------------------------------ flights

/** Best plan for a combat card: { plan, score }. */
function bestPlan(ctx, aircraftId, cardKey, options) {
    const a = ctx.view.aircraft[aircraftId];
    const t = TYPES[cardKey];
    const man = t.actions.find((x) => x.type === 'manoeuvre');
    let best = { plan: options[0].id, score: -Infinity };
    for (const o of options) {
        const turns = o.id === 'manoeuvre' ? man.value : 0;
        const start = { hex: a.hex, facing: a.facing, moved: 0, turns, turnedLast: false, pre: o.id === 'manoeuvre' && man.pre };
        let score = bestFlight(ctx, a, t.move, start, o.id === 'moveThenAct').score;
        if (o.id === 'actFirst') score += bestShot(ctx, a);
        if (score > best.score) best = { plan: o.id, score };
    }
    return best;
}

/** Score of playing a combat card now, against leaving the aircraft where it is. */
function cardScore(ctx, cardKey) {
    const a = ctx.view.aircraft[baseId(cardKey)];
    if (!a || a.status !== 'board') return -Infinity;
    // the card only readies it: a grounded RAF aircraft takes off (bombs can neutralise it on the ground), a
    // suppressed Luftwaffe one is back in the fight
    if (!a.ready) return grounded(a) ? W.takeOff : W.suppressed;
    const t = TYPES[cardKey];
    const options = [{ id: 'move' }, { id: 'moveThenAct' }];
    if (t.actions.some((x) => x.type === 'manoeuvre')) options.push({ id: 'manoeuvre' });
    if (bestShot(ctx, a) > 0) options.push({ id: 'actFirst' });
    return bestPlan(ctx, a.id, cardKey, options).score - endScore(ctx, a, a, 'stop', false) + W.playBias;
}

/**
 * Every way to finish the move from `state` (mirrors moveAircraft in the engine), scored by where it ends.
 * @returns {{ first: string, score: number }} the first step of the best one
 */
function bestFlight(ctx, a, max, state, actAfter) {
    let best = { first: 'stop', score: -Infinity };
    const consider = (first, pos, end) => {
        const score = endScore(ctx, a, pos, end, actAfter);
        if (score > best.score) best = { first, score };
    };
    const go = (hex, facing, moved, turns, turnedLast, pre, first) => {
        if (moved < max) {
            const ahead = step(hex, facing);
            const exit = escapeHere(ctx, a, hex);
            const f = first ?? (ctx.board.has(ahead) || !exit ? 'fwd' : 'escape');
            if (!ctx.board.has(ahead)) consider(f, { hex, facing }, exit ? 'escape' : 'edge');
            else if (ctx.balloons.has(ahead)) consider(f, { hex: ahead, facing }, 'dead');
            else go(ahead, facing, moved + 1, turns, false, false, f);
        }
        if (turns > 0 && !turnedLast && (moved > 0 || pre)) {
            for (const side of ['left', 'right']) go(hex, turn(facing, side === 'left' ? -1 : 1), moved, turns - 1, true, false, first ?? side);
        }
        if (moved > 0) consider(first ?? 'stop', { hex, facing }, 'stop');
    };
    go(state.hex, state.facing, state.moved, state.turns, state.turnedLast, state.pre, null);
    return best;
}

/** turn.js canEscape, on the view: an escape hex, for an aircraft that may escape now. */
const escapeHere = (ctx, a, hex) => escaping(ctx, a) && ctx.exits.has(hex);

/** How good it is for aircraft `a` to end its move at `pos` ({ hex, facing }), then act if `actAfter`. */
function endScore(ctx, a, pos, end, actAfter) {
    if (end === 'dead') return -W.dead;
    if (end === 'escape') return ctx.conds.some((c) => c.escape != null || c.per?.escaped) ? W.escaped : W.strayEscape;
    const ghost = { ...a, hex: pos.hex, facing: pos.facing };
    const g = withAircraft(ctx.view, a.id, ghost);
    const gctx = { ...ctx, view: g };
    let v = 0;
    if (end === 'edge') v -= W.edge;
    else if (actAfter) v += bestShot(gctx, ghost);
    const ahead = step(pos.hex, pos.facing);
    // facing off the board from an escape hex is the way out; on any other edge hex it is a bump
    if (!ctx.board.has(ahead)) v -= escapeHere(ctx, a, pos.hex) ? W.facingExit : W.facingEdge;
    else {
        if (ctx.balloons.has(ahead)) v -= W.facingBalloon;
        if (!escapeHere(ctx, a, ahead) && !ctx.board.has(step(ahead, pos.facing))) v -= W.nearEdge;
    }
    v -= W.danger * danger(gctx, ghost) * ownWorth(ctx, a);
    v += W.next * nextShot(gctx, ghost);
    const section = sectionOf(a);
    const mate = Object.values(g.aircraft).find((x) => x.id !== a.id && x.seat === a.seat && !x.decoy && x.status === 'board' && sectionOf(x) === section && section);
    if (mate && !a.decoy) v -= W.wingman * Math.min(W.wingmanMax, Math.max(0, distance(mate.hex, pos.hex) - 1));
    const goal = goalPull(gctx, ghost) ?? huntPull(gctx, ghost);
    if (goal != null) v += goal;
    else {
        const enemies = foesOnBoard(g, ctx.me);
        if (enemies.length) v -= W.approach * Math.min(...enemies.map((e) => distance(e.hex, pos.hex)));
    }
    return v;
}

/** Best expected value of the aircraft's attack or bomb from where it is (in the view `ctx.view`). */
function bestShot(ctx, a) {
    if (!a || a.status !== 'board' || !a.ready || a.decoy) return 0;
    let best = 0;
    for (const act of TYPES[baseId(a.id)].actions) {
        const opts = act.type === 'attack' ? attackTargets(ctx.view, a, act) : act.type === 'bomb' ? bombTargets(ctx.view, a, act) : [];
        for (const o of opts) best = Math.max(best, shotValue(ctx, { ...o, type: act.type }));
    }
    return best;
}

/** Positions an aircraft can shoot from on its next card: where it is, or after a straight move. */
const reach = (ctx, a) => line(ctx.board, a.hex, a.facing).slice(0, TYPES[baseId(a.id)].move + 1).map((hex) => ({ ...a, hex }));

/** Expected hits the enemy can land on `a` before it moves again (each enemy acts with a share of its hand). */
function danger(ctx, a) {
    const foes = foesOnBoard(ctx.view, ctx.me).filter((e) => e.ready);
    const share = Math.min(1, W.dangerCards / Math.max(1, foes.length));
    let sum = 0;
    for (const e of foes) {
        const atk = TYPES[baseId(e.id)].actions.find((x) => x.type === 'attack');
        if (!atk) continue;
        let best = 0;
        for (const pos of reach(ctx, e)) {
            const o = attackTargets(withAircraft(ctx.view, e.id, pos), pos, atk).find((x) => x.target === a.id);
            if (o) best = Math.max(best, hitChance(o.total, o.dice));
        }
        sum += best * share;
    }
    return sum;
}

/** Best shot the aircraft will have on its next card, if the enemy stayed put. */
function nextShot(ctx, a) {
    let best = 0;
    for (const pos of reach(ctx, a)) best = Math.max(best, bestShot({ ...ctx, view: withAircraft(ctx.view, a.id, pos) }, pos));
    return best;
}

/** Pull towards the nearest of `hexes`: `perHex` for each hex away, `facing` for each hex the next step adds. */
function pullTo(ctx, a, hexes, perHex, facing) {
    const ahead = step(a.hex, a.facing);
    const d = Math.min(...hexes.map((h) => distance(h, a.hex)));
    const dAhead = ctx.board.has(ahead) ? Math.min(...hexes.map((h) => distance(h, ahead))) : d + 1;
    return { d, pull: -d * perHex - (dAhead - d) * facing };
}

/**
 * A fighter's pull towards the enemy aircraft its objective singles out: those it must neutralise when the others do
 * not count (the Stukas of scenario 2, the Heinkels of 4, the Heinkels and Bf 110s of 6). Null when every enemy
 * counts, even if some count more (aces in 10, Stukas and Heinkels in 3: chasing only those played worse); then the
 * aircraft only drifts towards the nearest enemy (W.approach).
 */
function huntPull(ctx, a) {
    if (!has(a, 'attack')) return null;
    const enemies = foesOnBoard(ctx.view, a.seat);
    const counts = (e) => ctx.conds.some((c) => c.neutralise != null && (c.units || c.aircraft || c.rank) && matches(e, c));
    const prey = enemies.filter(counts);
    if (!prey.length || prey.length === enemies.length) return null;
    return pullTo(ctx, a, prey.map((e) => e.hex), W.hunt, W.huntFacing).pull;
}

/**
 * Pull towards the aircraft's own goal: a bomber towards the nearest marker its objective counts (worth more than 1)
 * or grounded RAF aircraft, an aircraft that may escape now towards the escape hexes (escapePull); the better of the
 * two when both. Null if it has none.
 */
function goalPull(ctx, a) {
    const goals = [];
    if (has(a, 'bomb')) {
        for (const m of ctx.view.markers) if (m.status === 'board' && markerWorth(ctx.conds, m.type) > 1) goals.push(m.hex);
        for (const e of Object.values(ctx.view.aircraft)) if (e.seat !== a.seat && e.status === 'board' && grounded(e)) goals.push(e.hex);
    }
    const escape = escaping(ctx, a) && ctx.s.escape?.length ? escapePull(ctx, a) : null;
    if (!goals.length) return escape;
    const { d, pull } = pullTo(ctx, a, goals, W.bomb, W.bombFacing);
    const bomb = pull + (d === 0 ? W.onTarget : 0);
    return escape == null ? bomb : Math.max(bomb, escape);
}

/**
 * Towards the escape hexes: how far the nearest is, and how much two straight moves bring it closer. Counting only
 * the next hex is not enough: on a straight edge a diagonal flight keeps the same distance hex after hex (the
 * Heinkel of scenario 3 flew north-east, two hexes from the edge, for rounds). At an escape hex facing off the
 * board it is about to escape.
 */
function escapePull(ctx, a) {
    const exits = [...ctx.exits];
    const dist = (h) => Math.min(...exits.map((k) => distance(k, h)));
    const d = dist(a.hex);
    const path = line(ctx.board, a.hex, a.facing).slice(0, 3); // where it is and up to two straight moves
    const straight = path.length > 1 ? dist(path[path.length - 1]) : d === 0 ? -1 : d + 1;
    return -d * W.escape - (straight - d) * W.escapeFacing + (d === 0 ? W.onTarget : 0);
}

