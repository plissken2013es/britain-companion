// What the player must do on the table after each answer (docs/02 §8.3), from the public log: the computer's cards and
// their effects (its counters flown, its attacks with their dice, the counters and markers that change) and what the
// player does with their own cards (draw, Discord, Bolster, the end of the turn). One step per line, shown one by one
// with "Done". A step: { head?, text, lines?, focus?, arrow?, dice?, side, kind, at }: `dice` = the computer's
// virtual dice to roll on screen; `at` = the entry after which the map shows the table (boardAt).
// The board has no coordinates: a flight is told as the player moves the counter, "forward, forward, turn right".
// Ported from 61's companion/guide.js.

import { t } from '../src/i18n/index.js';
import { TYPES, SIDES, baseId } from '../src/engine/data.js';
import { cardName, markerName, sideName } from '../src/ui/text.js';
import { planeName, dirName, cardList } from './names.js';

/**
 * @param {any[]} entries log entries since the last answer
 * @param {number} me the player's seat
 * @param {any} before the player's view before them (markers and counters as they were)
 */
export function guideSteps(entries, me, before) {
    const bot = 1 - me;
    const out = [];
    const pn = (id) => planeName(id, before, me);
    let head = null; // the computer's card being played
    let played = null; // the part of `head` to stand out: its card
    let at = 0;
    const push = (step) => out.push({ head: step.mine ? null : head, played: step.mine ? null : played, side: SIDES[step.mine ? me : bot], at, ...step });
    const markerOf = (id) => before.markers.find((m) => m.id === id);
    for (let i = 0; i < entries.length; i++) {
        at = i;
        const e = entries[i];
        const mine = e.seat === me;
        switch (e.k) {
            case 'turnStart':
                head = played = null;
                break;
            case 'bids': {
                const ini = (c) => (c ? TYPES[c].initiative : 0);
                const name = (c) => (c ? cardName(c) : '—');
                const text = [t('cmp.g.bids', { mine: name(e.cards[me]), a: ini(e.cards[me]), theirs: name(e.cards[bot]), b: ini(e.cards[bot]) }),
                    t(`cmp.g.${e.kept ? 'kept' : 'initiative'}${e.initiative === me ? 'You' : 'Bot'}`)].join(' ');
                push({ text, kind: 'info', mine: true, sound: 'chime' });
                if (e.cards[me]) push({ text: t('cmp.c.bid', { card: cardName(e.cards[me]) }), kind: 'cards', mine: true });
                break;
            }
            case 'deployed':
                if (!mine) push({ text: t('cmp.g.deployed', { aircraft: pn(e.aircraft), facing: dirName(e.facing) }), focus: { aircraft: e.aircraft, hex: e.hex }, kind: 'table', sound: 'deploy' });
                break;
            case 'played': {
                if (mine) break;
                played = cardName(e.card);
                head = t('cmp.g.botPlays', { card: played });
                // a card whose effects do not touch the table (Bolster, Command, going dark…): the card itself is the step
                const rest = untilNext(entries, i);
                if (!rest.some((x) => TABLE.has(x.k))) {
                    const lines = rest.filter((x) => QUIET.has(x.k)).map((x) => quietLine(x, me));
                    push({ text: head, lines, kind: 'info', head: t('cmp.g.botTurn') });
                }
                break;
            }
            case 'readied':
                push({ text: t(mine ? 'cmp.g.readiedYou' : 'cmp.g.readiedBot', { aircraft: pn(e.aircraft) }), focus: { aircraft: e.aircraft }, kind: 'table', mine });
                break;
            case 'guide':
                if (!mine) push({ text: t('cmp.g.guide', { aircraft: pn(e.aircraft) }), focus: { aircraft: e.aircraft }, kind: 'info' });
                break;
            case 'moved':
            case 'turned':
            case 'edge': {
                if (mine) break; // the player has moved it
                // one counter's steps make one flight: "forward, forward, turn right"
                const parts = [];
                const from = planeAt(boardAt(before, entries, i - 1), e.aircraft)?.hex;
                const path = [from].filter(Boolean);
                let j = i;
                for (; j < entries.length; j++) {
                    const x = entries[j];
                    if (x.aircraft !== e.aircraft || !['moved', 'turned', 'edge'].includes(x.k)) break;
                    if (x.k === 'moved') parts.push(t('cmp.g.fwd')), path.push(x.hex);
                    else if (x.k === 'turned') parts.push(t('cmp.g.turn', { facing: dirName(x.facing) }));
                    else parts.push(t('cmp.g.edgeTurn', { facing: dirName(x.facing) }));
                }
                i = j - 1;
                at = i;
                // the arrow goes through every hex it flew, not straight from where it was to where it is
                const arrow = from && path.length > 1 ? [{ from, path, to: e.aircraft, side: SIDES[bot] }] : [];
                push({ text: t('cmp.g.fly', { aircraft: pn(e.aircraft), steps: parts.join(', ') }), focus: { aircraft: e.aircraft, hexes: path }, arrow, kind: 'table', sound: 'engine' });
                break;
            }
            case 'combat': {
                if (mine && !e.dice) break; // the player rolled: they know
                const target = TYPES[baseId(e.target)] ? pn(e.target) : markerName(markerOf(e.target));
                const what = t(`cmp.g.combat.${e.type}`, { by: e.by ? pn(e.by) : sideName(e.seat), target, n: e.dice?.length ?? 0, total: e.total });
                const result = t(e.success ? 'cmp.g.hit' : 'cmp.g.miss');
                push({
                    text: what,
                    after: !e.dice ? t('cmp.g.result', { result }) : e.dice.length ? t('cmp.g.dice', { dice: e.dice.join(' '), result }) : t('cmp.g.impossible'),
                    dice: e.dice?.length ? e.dice : null, hit: e.success, total: e.total,
                    focus: { aircraft: e.target },
                    arrow: e.by ? [{ from: e.by, to: e.target, side: SIDES[e.seat] }] : [],
                    kind: 'attack',
                    fire: e.type, seat: e.seat,
                    mine,
                });
                break;
            }
            case 'hit':
                if (mine) push({ text: t(e.from === 'deck' ? 'cmp.g.hitDeck' : 'cmp.g.hitYou', { aircraft: pn(e.aircraft), from: t(`log.from.${e.from}`) }), focus: { aircraft: e.aircraft }, kind: 'cards', mine: true });
                else push({ text: t('cmp.g.hitBot', { aircraft: pn(e.aircraft), from: t(`log.from.${e.from}`) }), focus: { aircraft: e.aircraft }, kind: 'info' });
                break;
            case 'suppressed':
                push({ text: t(mine ? 'cmp.g.suppressedYou' : 'cmp.g.suppressedBot', { aircraft: pn(e.aircraft) }), focus: { aircraft: e.aircraft }, kind: 'table', mine, sound: 'thud' });
                break;
            case 'neutralised':
            case 'escaped':
                push({ text: t(`cmp.g.${e.k}`, { aircraft: pn(e.aircraft), why: e.why ? t(`log.why.${e.why}`) : '' }), focus: { aircraft: e.aircraft }, kind: 'table', mine, sound: e.k === 'neutralised' ? 'fall' : 'engine' });
                if (mine) push({ text: t('cmp.c.purge', { aircraft: pn(e.aircraft) }), kind: 'cards', mine: true });
                break;
            case 'decoyRemoved':
                push({ text: t(`cmp.g.decoy.${e.why}`, { aircraft: pn(e.aircraft) }), lines: mine ? [] : [t('cmp.g.decoySwap', { aircraft: cardName(baseId(e.aircraft)) })], focus: { aircraft: e.aircraft }, kind: 'table', mine });
                break;
            case 'destroyed':
                push({ text: t('cmp.g.destroyed', { marker: markerName(markerOf(e.marker)) }), focus: { marker: e.marker }, kind: 'table', mine, sound: 'boom' });
                break;
            case 'sailed':
                push({ text: t('cmp.g.sailed'), focus: { marker: e.marker, hex: e.hex }, kind: 'table', mine });
                break;
            case 'shipEscaped':
                push({ text: t('cmp.g.shipEscaped'), focus: { marker: e.marker }, kind: 'table', mine });
                break;
            case 'discord':
                if (mine) push({ text: t('cmp.c.discord', { why: t(`log.why.${e.why}`) }), kind: 'cards', mine: true, sound: 'discord' });
                else push({ text: t('cmp.g.discordBot', { why: t(`log.why.${e.why}`) }), kind: 'info' });
                break;
            case 'discordNone':
                if (mine) push({ text: t('cmp.c.discordNone'), kind: 'cards', mine: true });
                break;
            case 'draw':
                if (mine) push({ text: drawText(e, entries, i), kind: 'cards', mine: true });
                break;
            case 'bolster':
                if (mine) push({ text: t('cmp.c.bolster', { card: cardName(e.card) }), kind: 'cards', mine: true });
                break;
            case 'coordinate':
                if (mine) push({ text: t('cmp.c.coordinate'), kind: 'cards', mine: true });
                break;
            case 'dark':
                if (mine) push({ text: t('cmp.c.dark', { card: cardName(e.card) }), kind: 'cards', mine: true });
                break;
            case 'turnEnd': {
                if (!mine) break;
                const left = entries.slice(0, i).findLast((x) => x.k === 'leftover' && x.seat === me);
                push({ text: left ? t('cmp.c.endTurnLeft', { cards: cardList(left.cards) }) : t('cmp.c.endTurn'), kind: 'cards', mine: true });
                break;
            }
            default:
                break;
        }
    }
    return out;
}

/** Entries that change the table (a step of their own after the computer's card). */
const TABLE = new Set(['moved', 'turned', 'edge', 'combat', 'readied', 'sailed', 'shipEscaped', 'guide', 'destroyed', 'neutralised', 'escaped', 'suppressed', 'decoyRemoved']);
/** Effects of a comms card that stay in the computer's cards: told under the card. */
const QUIET = new Set(['dark', 'bolster', 'command', 'coordinate', 'inspire']);

/** The computer's entries after entries[i] until its next card or the end of its turn. */
function untilNext(entries, i) {
    const out = [];
    for (const x of entries.slice(i + 1)) {
        if (x.k === 'played' || x.k === 'turnEnd') break;
        out.push(x);
    }
    return out;
}

function quietLine(e, me) {
    const p = { side: sideName(e.seat) };
    if (e.card) p.card = cardName(e.card);
    return t(`cmp.g.q.${e.k}`, p);
}

function drawText(e, entries, i) {
    if (!e.n) return t('cmp.c.drawNone');
    const out = [];
    const before = entries.slice(0, i).findLast((x) => x.k !== 'reshuffle' && x.k !== 'draw');
    if (e.first == null) out.push(before?.k === 'round' ? t('cmp.c.drawRound', { round: before.round, n: e.n }) : t('cmp.c.draw', { n: e.n }));
    else if (e.first === 0) out.push(t('cmp.c.drawShuffleFirst', { n: e.n }));
    else out.push(t('cmp.c.drawShuffle', { first: e.first, rest: e.n - e.first }));
    if (e.n < e.want) out.push(t('cmp.c.drawShort', { n: e.n, want: e.want }));
    return out.join(' ');
}

// ------------------------------------------------------------------ the table and the cards, step by step

const ROUND_DRAW = 4; // game.js: both sides draw 4 at the start of each round
const keyOf = (cid) => cid.slice(0, cid.lastIndexOf(':'));

/** Card ids or a { key: n } count, as a new { key: n } count. */
function counts(cards) {
    const n = {};
    if (Array.isArray(cards)) for (const c of cards) n[keyOf(c)] = (n[keyOf(c)] ?? 0) + 1;
    else Object.assign(n, cards);
    return n;
}

const size = (pile) => Object.values(pile).reduce((a, b) => a + b, 0);

function add(pile, key, k = 1) {
    pile[key] = (pile[key] ?? 0) + k;
    if (!pile[key]) delete pile[key];
}

/** Takes up to `k` cards of an aircraft out of a { key: n } pile; how many there were. */
function takeAll(pile, key, k = Infinity) {
    const n = Math.min(pile[key] ?? 0, k);
    add(pile, key, -n);
    return n;
}

/**
 * Both sides' cards after entries[0..upto], from their view before them (`players`), with the piles as { key: n }:
 * what the cards panel shows with each step, so it never gets ahead of the "Done" cards. An external seat's draws are
 * in the log ('draw', after any 'reshuffle'); the computer's are not, so they are worked out from where they happen
 * (a round, Command, Coordinate) and what its deck and discard pile hold.
 */
export function playersAt(players, entries, upto) {
    const ps = players.map((p) => ({
        ...p, hidden: p.hidden && counts(p.hidden), discard: counts(p.discard), play: counts(p.play), supply: counts(p.supply), removed: p.removed && counts(p.removed),
    }));
    // out of the hand: for an external seat, out of the hand and deck it holds together
    const fromHand = (p, key) => {
        p.handCount--;
        if (p.hidden) add(p.hidden, key, -1);
    };
    const draw = (p, n) => {
        if (n > p.deckCount && size(p.discard)) {
            p.deckCount += size(p.discard);
            p.discard = {};
        }
        const k = Math.min(n, p.deckCount);
        p.deckCount -= k;
        p.handCount += k;
    };
    const remove = (p, key, k = 1) => {
        if (p.removed) add(p.removed, key, k);
        p.removedCount += k;
    };
    for (const e of entries.slice(0, upto + 1)) {
        const p = ps[e.seat];
        switch (e.k) {
            case 'round':
                for (const q of ps) if (!q.external) draw(q, ROUND_DRAW);
                break;
            case 'reshuffle':
                if (!p.external) break;
                p.deckCount += size(p.discard);
                for (const [key, k] of Object.entries(p.discard)) add(p.hidden, key, k);
                p.discard = {};
                break;
            case 'draw':
                p.deckCount -= e.n;
                p.handCount += e.n;
                break;
            case 'bids':
                e.cards.forEach((key, s) => {
                    if (!key) return;
                    fromHand(ps[s], key);
                    add(ps[s].discard, key);
                });
                break;
            case 'played':
                fromHand(p, e.card);
                add(p.play, e.card);
                break;
            case 'dark':
                add(p.play, e.card, -1);
                add(p.supply, e.card);
                break;
            case 'bolster':
                add(p.supply, e.card, -1);
                add(p.discard, e.card);
                break;
            case 'discord': {
                const key = `${p.side}:discord`;
                add(p.supply, key, -1);
                add(p.discard, key);
                break;
            }
            case 'coordinate':
                fromHand(p, `${p.side}:discord`);
                p.aside++;
                if (!p.external) draw(p, 1);
                break;
            case 'command':
                if (!p.external) draw(p, 1);
                break;
            case 'hit': {
                const key = baseId(e.aircraft);
                if (e.from === 'hand') fromHand(p, key);
                else if (e.from === 'deck') {
                    p.deckCount--;
                    if (p.hidden) add(p.hidden, key, -1);
                } else add(p.discard, key, -1);
                remove(p, key);
                break;
            }
            case 'neutralised':
            case 'escaped': {
                const key = baseId(e.aircraft);
                const c = e.cards ?? {};
                for (const z of ['discard', 'play', 'supply']) if (c[z]) remove(p, key, takeAll(p[z], key, c[z]));
                if (c.hand) (p.handCount -= c.hand), remove(p, key, c.hand);
                if (c.deck) (p.deckCount -= c.deck), remove(p, key, c.deck);
                if (c.hidden) {
                    // as the engine: from the deck as far as it had them, until the player says ('purged')
                    const n0 = Math.max(0, c.hidden - p.deckCount);
                    p.handCount -= n0;
                    p.deckCount -= c.hidden - n0;
                    takeAll(p.hidden, key, c.hidden);
                    remove(p, key, c.hidden);
                }
                break;
            }
            case 'purged':
                p.handCount -= e.moved;
                p.deckCount += e.moved;
                break;
            case 'leftover':
                // an external seat answers card by card, each going to the discard pile at once, and the log only lists
                // them all when done: the first ones may already be out of the hand in `players`
                for (const key of e.cards.slice(Math.max(0, e.cards.length - p.handCount))) {
                    fromHand(p, key);
                    add(p.discard, key);
                }
                break;
            case 'turnEnd':
                for (const [key, k] of Object.entries(p.play)) add(p.discard, key, k);
                p.play = {};
                break;
            default:
                break;
        }
    }
    return ps;
}

/** An aircraft of a view by the id the log uses: a paired counter by its public alias, its owner's view by its own id (with `pub`). */
const planeAt = (v, id) => v.aircraft[id] ?? Object.values(v.aircraft).find((a) => a.pub === id);

/**
 * The view after entries[0..upto] (the counters and markers those entries change, and both sides' cards), from the
 * view before them: what the map and the cards panel show with each step.
 */
export function boardAt(before, entries, upto) {
    const v = { ...before, aircraft: structuredClone(before.aircraft), markers: structuredClone(before.markers), players: playersAt(before.players, entries, upto) };
    const plane = (id) => planeAt(v, id);
    for (const e of entries.slice(0, upto + 1)) {
        const a = e.aircraft && plane(e.aircraft);
        const m = e.marker && v.markers.find((x) => x.id === e.marker);
        switch (e.k) {
            case 'deployed':
                Object.assign(a, { hex: e.hex, facing: e.facing, status: 'board' });
                break;
            case 'moved':
                a.hex = e.hex;
                break;
            case 'turned':
            case 'edge':
                a.facing = e.facing;
                break;
            case 'readied':
                a.ready = true;
                break;
            case 'suppressed':
                a.ready = false;
                break;
            case 'neutralised':
            case 'escaped':
                a.status = e.k;
                break;
            case 'decoyRemoved':
                a.status = 'removed';
                break;
            case 'destroyed':
                m.status = 'destroyed';
                break;
            case 'sailed':
                m.hex = e.hex;
                break;
            case 'shipEscaped':
                m.status = 'escaped';
                break;
            default:
                break;
        }
    }
    return v;
}
