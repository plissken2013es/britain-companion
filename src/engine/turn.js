// A player's turn (docs/01 §5–§7): play cards one at a time; combat cards move and may act, comms cards act or go
// dark. Every choice is a request to the acting seat; option ids are listed in docs/02 §2.1.

import { choose, log, beat, note } from './ask.js';
import { TYPES, typeOf, SIDES, scenarioById, baseId } from './data.js';
import { step, turn, key, DIRS } from './hex.js';
import { attackTargets, antiAirTargets, bombTargets, resolve } from './combat.js';
import {
    boardOf, aircraftOfCard, drawCards, moveCard, gainDiscord, outOfComms, sectionOf, onBoard,
    neutralise, escapeAircraft, checkWin, escapeOpen, mayEscape, pub, decoyOf, removeDecoy, handPool, bring, isExternal, settlePurge,
} from './state.js';

const distinct = (cids) => [...new Map(cids.map((c) => [typeOf(c).id, c])).values()];

export function* playerTurn(g, seat) {
    g.turn = seat;
    const p = g.players[seat];
    log(g, 'turnStart', { seat });
    for (;;) {
        const playable = distinct(handPool(g, seat).filter((c) => canPlay(g, c)));
        // nothing in hand can be played (Discord, the cards of aircraft off the board) and nothing was played yet: the
        // turn ends by itself. Private, since the opponent cannot tell it from a pass; the UI says so (fx.js)
        if (!playable.length && p.hand.length && !p.play.length && !isExternal(g, seat)) note(g, seat, 'stuck', { cards: p.hand.map((c) => typeOf(c).key), at: g.log.length });
        const answer = yield* choose(g, seat, 'play', [...playable.map((c) => ({ id: `play:${typeOf(c).id}`, card: typeOf(c).key })), { id: 'end' }]);
        if (answer === 'end') break;
        const cid = bring(g, seat, (c) => typeOf(c).id === answer.slice(5));
        yield* playCard(g, seat, cid);
        checkWin(g);
    }
    // the cards left in hand go to the discard pile, which anyone may look at ([D-11]): the log says which
    if (isExternal(g, seat)) yield* leftovers(g, seat);
    else if (p.hand.length) log(g, 'leftover', { seat, cards: p.hand.map((c) => typeOf(c).key).sort() });
    p.discard.push(...p.hand, ...p.play);
    p.hand = [];
    p.play = [];
    log(g, 'turnEnd', { seat });
}

/** An external seat ends its turn with cards in hand: they go to the discard pile, so it says which, one at a time. */
function* leftovers(g, seat) {
    const p = g.players[seat];
    if (!p.hand.length) return;
    const cards = [];
    while (p.hand.length) {
        const opts = distinct(handPool(g, seat)).map((c) => ({ id: `card:${typeOf(c).id}`, card: typeOf(c).key }));
        const answer = yield* choose(g, seat, 'leftover', opts, { left: p.hand.length });
        const c = bring(g, seat, (x) => typeOf(x).id === answer.slice(5));
        moveCard(g, seat, c, 'hand', 'discard');
        cards.push(typeOf(c).key);
    }
    // in the order they were named: the companion's steps know which ones were already out of the hand (guide.js)
    log(g, 'leftover', { seat, cards });
}

function canPlay(g, cid) {
    const t = typeOf(cid);
    if (t.kind === 'discord') return false;
    if (t.kind === 'combat') return g.aircraft[aircraftOfCard(cid)]?.status === 'board';
    return true; // a comms card can always go dark
}

function* playCard(g, seat, cid) {
    const t = typeOf(cid);
    log(g, 'played', { seat, cid, card: t.key });
    yield* beat(g, 'played', { seat, card: t.key });
    if (t.kind === 'combat') {
        moveCard(g, seat, cid, 'hand', 'play');
        yield* flyCard(g, seat, cid);
    } else yield* playComms(g, seat, cid);
}

// ------------------------------------------------------------------ combat cards

/**
 * Move (mandatory) plus at most one card action, in either order (docs/01 §5). Also used by Inspire.
 * Manoeuvre is announced before moving and modifies the move.
 */
export function* flyCard(g, seat, cid) {
    const t = typeOf(cid);
    const a = g.aircraft[aircraftOfCard(cid)];
    if (a.status !== 'board') return;
    if (!a.ready) {
        a.ready = true;
        log(g, 'readied', { seat, aircraft: a.id });
        return;
    }
    const man = t.actions.find((x) => x.type === 'manoeuvre');
    const plans = [{ id: 'move' }];
    if (man) plans.push({ id: 'manoeuvre', value: man.value, pre: Boolean(man.pre) });
    const now = combatOptions(g, a, t);
    if (now.length) plans.push({ id: 'actFirst' });
    plans.push({ id: 'moveThenAct' });
    const plan = yield* choose(g, seat, 'plan', plans, { aircraft: a.id, card: t.key });
    if (plan === 'actFirst') yield* cardAction(g, seat, a, t);
    const turns = plan === 'manoeuvre' ? man.value : 0;
    const pre = plan === 'manoeuvre' && man.pre;
    const edge = yield* moveAircraft(g, seat, a, t.move, turns, pre, plan === 'moveThenAct');
    // scenario 9: the decoy moves and manoeuvres too, independently ([D-14])
    const twin = decoyOf(g, a);
    if (twin) yield* moveAircraft(g, seat, twin, t.move, turns, pre);
    if (plan === 'moveThenAct' && !edge && a.status === 'board') yield* cardAction(g, seat, a, t, true);
}

/** Attack / Bomb options for aircraft a with card type t right now (targets by public id: decoys stay hidden). */
function combatOptions(g, a, t) {
    const out = [];
    for (const act of t.actions) {
        if (act.type === 'attack') for (const o of attackTargets(g, a, act)) out.push({ ...o, id: `attack:${pub(g, o.target)}`, type: 'attack', target: pub(g, o.target) });
        if (act.type === 'bomb') for (const o of bombTargets(g, a, act)) out.push({ ...o, id: `bomb:${pub(g, o.target)}`, type: 'bomb', target: pub(g, o.target) });
    }
    return out;
}

function* cardAction(g, seat, a, t, optional = false) {
    const opts = combatOptions(g, a, t);
    if (!opts.length) return;
    const answer = yield* choose(g, seat, 'combat', [...opts, ...(optional ? [{ id: 'none' }] : [])], { aircraft: a.id });
    if (answer === 'none') return;
    const opt = opts.find((o) => o.id === answer);
    // scenario 9: an aircraft that takes a combat action gives its decoy away
    const twin = decoyOf(g, a);
    if (twin) removeDecoy(g, twin, 'acted');
    yield* resolve(g, seat, opt.type, opt, a.id);
}

/**
 * docs/01 §6. Step by step: "fwd", "left"/"right" (manoeuvre), "stop" once moved, "escape" from an escape hex.
 * @returns {boolean} true if the move hit the board edge (no card action afterwards)
 */
export function* moveAircraft(g, seat, a, max, turns, pre, act = false) {
    const board = boardOf(g);
    let moved = 0;
    let turnedLast = false;
    for (;;) {
        const opts = [];
        if (moved < max) opts.push(canEscape(g, a) && !board.has(step(a.hex, a.facing)) ? { id: 'escape' } : { id: 'fwd' });
        const mayTurn = turns > 0 && !turnedLast && (moved > 0 || pre);
        if (mayTurn) opts.push({ id: 'left' }, { id: 'right' });
        if (moved > 0) opts.push({ id: 'stop' });
        if (!opts.length) return false;
        // the request tells the bots all they need to plan the rest of the move: whether the card acts after it,
        // and why a turn is or is not offered (it just turned; it has not moved yet and only an ace turns first)
        const answer = yield* choose(g, seat, 'move', opts, { aircraft: a.id, moved, max, turns, act, turnedLast, pre });
        if (answer === 'stop') return false;
        if (answer === 'escape') {
            escapeAircraft(g, a);
            yield* settlePurge(g);
            return true;
        }
        if (answer === 'left' || answer === 'right') {
            a.facing = turn(a.facing, answer === 'left' ? -1 : 1);
            turns--;
            turnedLast = true;
            pre = false;
            log(g, 'turned', { seat, aircraft: a.id, facing: a.facing });
            continue;
        }
        const result = yield* advance(g, seat, a);
        if (result !== 'moved') return result === 'edge';
        moved++;
        turnedLast = false;
        pre = false;
    }
}

/** One hex forward with the balloon and board-edge rules (docs/01 §6, [D-7]). */
function* advance(g, seat, a) {
    const next = step(a.hex, a.facing);
    if (!boardOf(g).has(next)) {
        const side = yield* choose(g, seat, 'edge', [{ id: 'left' }, { id: 'right' }], { aircraft: a.id });
        a.facing = turn(a.facing, side === 'left' ? -1 : 1);
        log(g, 'edge', { seat, aircraft: a.id, facing: a.facing });
        gainDiscord(g, seat, 'edge');
        return 'edge';
    }
    if (g.markers.some((m) => m.type === 'balloon' && m.status === 'board' && m.hex === next)) {
        a.hex = next;
        neutralise(g, a, 'balloon');
        yield* settlePurge(g);
        return 'dead';
    }
    a.hex = next;
    log(g, 'moved', { seat, aircraft: a.id, hex: next });
    yield* beat(g, 'moved', { seat, aircraft: a.id });
    return 'moved';
}

/** Escape hexes of the scenario, for the aircraft types its `escapers` lets out (docs/01 §10, docs/02 §2.3). */
function canEscape(g, a) {
    const s = scenarioById(g.scenario);
    if (!(s.escape ?? []).some(([c, d]) => key(c, d) === a.hex)) return false;
    return mayEscape(g, a) && escapeOpen(g, a.seat);
}

// ------------------------------------------------------------------ comms cards

function* playComms(g, seat, cid) {
    const t = typeOf(cid);
    const p = g.players[seat];
    const out = outOfComms(g, seat, t.section);
    // the card leaves the hand first, so an external seat's hand pool does not count it (Coordinate needs another card)
    moveCard(g, seat, cid, 'hand', 'play');
    const opts = [];
    const blocked = []; // Bolster with nothing to take, shown greyed with the reason (not an option)
    t.actions.forEach((act, i) => {
        if (act.icon === 'blocked' && out) return;
        if (available(g, seat, act)) opts.push({ id: `act:${i}`, action: act.type, value: act.value, section: act.section, discord: act.icon === 'discord' && out });
        else if (act.type === 'bolster') blocked.push({ action: act.type, value: act.value, section: act.section, reason: bolsterBlock(p.supply, act) });
    });
    opts.push({ id: 'dark' });
    const answer = yield* choose(g, seat, 'comms', opts, { card: t.key, blocked });
    if (answer === 'dark') {
        moveCard(g, seat, cid, 'play', 'supply');
        log(g, 'dark', { seat, card: t.key });
        return;
    }
    const act = t.actions[Number(answer.slice(4))];
    if (act.icon === 'discord' && out) gainDiscord(g, seat, 'comms');
    yield* doAction(g, seat, act);
}

const sectionOk = (act, section) => !act.section || act.section === section;

/** Cards Bolster can take: never a Discord, which is always worse than taking none ([D-22]). */
function bolsterable(g, seat, act) {
    return g.players[seat].supply.filter((c) => typeOf(c).kind !== 'discord' && sectionOk(act, typeOf(c).section));
}

/**
 * Why a Bolster action has nothing to take from `supply` (card ids), or null if it has:
 * 'empty' (no cards), 'discord' (only Discord, [D-22]) or 'section' (none of its section).
 */
export function bolsterBlock(supply, act) {
    if (!supply.length) return 'empty';
    const useful = supply.filter((c) => typeOf(c).kind !== 'discord');
    if (!useful.length) return 'discord';
    return useful.some((c) => sectionOk(act, typeOf(c).section)) ? null : 'section';
}

function inspirable(g, seat, act) {
    return g.players[seat].play.filter((c) => {
        const t = typeOf(c);
        return t.kind === 'combat' && sectionOk(act, t.section) && g.aircraft[aircraftOfCard(c)]?.status === 'board';
    });
}

function available(g, seat, act) {
    const p = g.players[seat];
    switch (act.type) {
        case 'bolster': return bolsterable(g, seat, act).length > 0;
        case 'command': return p.deck.length + p.discard.length > 0;
        case 'coordinate': return handPool(g, seat).some((c) => typeOf(c).kind === 'discord');
        case 'guide': return onBoard(g).some((a) => a.seat === seat && a.ready && sectionOk(act, sectionOf(a)));
        case 'inspire': return inspirable(g, seat, act).length > 0;
        case 'anti-air': return antiAirTargets(g, seat, act).length > 0;
        case 'sail': return g.markers.some((m) => m.type === 'ship' && m.status === 'board');
        default: return false;
    }
}

function* doAction(g, seat, act) {
    const p = g.players[seat];
    switch (act.type) {
        case 'bolster': {
            for (let n = 0; n < act.value; n++) {
                const cands = distinct(bolsterable(g, seat, act));
                if (!cands.length) break;
                // «up to X»: after the first card you may stop; a single kind of card is taken without asking
                const answer = yield* choose(g, seat, 'bolster', [...cands.map((c) => ({ id: `take:${typeOf(c).id}`, card: typeOf(c).key })), ...(n > 0 ? [{ id: 'done' }] : [])], { left: act.value - n });
                if (answer === 'done') break;
                const c = p.supply.find((x) => typeOf(x).id === answer.slice(5) && sectionOk(act, typeOf(x).section));
                moveCard(g, seat, c, 'supply', 'discard');
                log(g, 'bolster', { seat, card: typeOf(c).key });
            }
            return;
        }
        case 'command': {
            for (let n = 0; n < act.value; n++) {
                if (!p.deck.length && !p.discard.length) break;
                const answer = yield* choose(g, seat, 'command', [{ id: 'draw' }, ...(n ? [{ id: 'done' }] : [])], { left: act.value - n });
                if (answer === 'done') break;
                drawCards(g, seat, 1);
                log(g, 'command', { seat });
            }
            return;
        }
        case 'coordinate': {
            const c = bring(g, seat, (x) => typeOf(x).kind === 'discord');
            moveCard(g, seat, c, 'hand', 'aside');
            log(g, 'coordinate', { seat });
            drawCards(g, seat, 1);
            return;
        }
        case 'guide': {
            const planes = onBoard(g).filter((a) => a.seat === seat && a.ready && sectionOk(act, sectionOf(a)));
            const answer = yield* choose(g, seat, 'guide', planes.map((a) => ({ id: `a:${a.id}`, aircraft: a.id })));
            const a = g.aircraft[answer.slice(2)];
            log(g, 'guide', { seat, aircraft: a.id });
            const res = yield* advance(g, seat, a);
            if (res !== 'moved') return;
            const side = yield* choose(g, seat, 'guideTurn', [{ id: 'none' }, { id: 'left' }, { id: 'right' }], { aircraft: a.id });
            if (side !== 'none') {
                a.facing = turn(a.facing, side === 'left' ? -1 : 1);
                log(g, 'turned', { seat, aircraft: a.id, facing: a.facing });
            }
            return;
        }
        case 'inspire': {
            const cands = distinct(inspirable(g, seat, act));
            const answer = yield* choose(g, seat, 'inspire', cands.map((c) => ({ id: `card:${typeOf(c).id}`, card: typeOf(c).key })));
            const c = p.play.find((x) => typeOf(x).id === answer.slice(5));
            log(g, 'inspire', { seat, card: typeOf(c).key });
            yield* flyCard(g, seat, c);
            return;
        }
        case 'anti-air': {
            const opts = antiAirTargets(g, seat, act).map((o) => ({ ...o, id: `antiAir:${pub(g, o.target)}`, type: 'antiAir', target: pub(g, o.target) }));
            const answer = yield* choose(g, seat, 'combat', opts);
            yield* resolve(g, seat, 'antiAir', opts.find((o) => o.id === answer), null);
            return;
        }
        case 'sail': {
            const moved = new Set();
            for (;;) {
                const ships = g.markers.filter((m) => m.type === 'ship' && m.status === 'board' && !moved.has(m.id));
                if (!ships.length) return;
                const answer = yield* choose(g, seat, 'sail', [...ships.map((m) => ({ id: `ship:${m.id}`, marker: m.id })), { id: 'done' }]);
                if (answer === 'done') return;
                const m = g.markers.find((x) => x.id === answer.slice(5));
                moved.add(m.id);
                const next = step(m.hex, m.facing);
                if (boardOf(g).has(next)) {
                    m.hex = next;
                    log(g, 'sailed', { seat, marker: m.id, hex: next });
                } else {
                    m.status = 'escaped';
                    log(g, 'shipEscaped', { seat, marker: m.id });
                    checkWin(g);
                }
            }
        }
    }
}

export { DIRS, note };
