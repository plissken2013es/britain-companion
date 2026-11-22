// The external seat (docs/02 §8.4): the companion's player keeps a physical deck and rolls physical dice; the engine
// only knows which cards are in their hand and deck together, and how many in each. Ported from 61 (its §7.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIOS } from '../src/engine/data.js';
import { casualtyFrom, createState, normalizeSetup, hit, handPool } from '../src/engine/state.js';
import { playerTurn } from '../src/engine/turn.js';
import { Session, makeRecord, replayRecord, fingerprint } from '../src/engine/session.js';
import { randomBot } from '../src/ai/randomBot.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { cardCount, drive, playOut } from './helpers.js';

const RAF = 0, LW = 1;
const ext = (scenario = 1, o = {}) => createState(normalizeSetup({ scenario, seed: 'ext', external: RAF, ...o }));
const type = (c) => c.split(':')[1];
const types = (cards) => cards.map(type).sort();
const first = (r) => r.options[0].id;

/** Puts these cards (by type) in the hand and the rest of hand + deck in the deck, as the engine might have them. */
function split(g, seat, hand) {
    const p = g.players[seat];
    const all = [...p.hand, ...p.deck];
    p.hand = [];
    for (const t of hand) p.hand.push(...all.splice(all.findIndex((c) => type(c) === t), 1));
    p.deck = all;
}

/** Moves one card of this type from the supply to zone `to`. */
function fromSupply(g, seat, t, to) {
    const p = g.players[seat];
    p[to].push(...p.supply.splice(p.supply.findIndex((c) => type(c) === t), 1));
}

test('setup: external seat and bot dice only when asked for (old codes stay the same)', () => {
    assert.deepEqual(Object.keys(normalizeSetup({ scenario: 1 })).sort(), ['maxRounds', 'scenario', 'seed']);
    assert.deepEqual(normalizeSetup({ scenario: 1, external: 1 }), { scenario: 1, seed: 'ubb', maxRounds: 100, external: 1, botDice: 'virtual' });
    assert.equal(normalizeSetup({ scenario: 1, external: 0, botDice: 'physical' }).botDice, 'physical');
    assert.equal(normalizeSetup({ scenario: 1, external: 2 }).external, undefined);
    const s = new Session({ scenario: 2, seed: 'r', external: 1, botDice: 'physical' });
    assert.deepEqual(replayRecord(makeRecord(s)).session.setup, s.setup);
});

test('view: the external hand is unknown, even to itself; its hand and deck are public as counts by type', () => {
    const s = new Session({ scenario: 1, seed: 'v', external: RAF });
    const v = s.view(RAF);
    assert.equal(v.external, RAF);
    assert.equal(v.botDice, 'virtual');
    assert.equal(v.players[RAF].hand, null);
    assert.equal(v.players[RAF].external, true);
    const p = s.state.players[RAF];
    const n = Object.values(v.players[RAF].hidden).reduce((a, b) => a + b, 0);
    assert.equal(n, p.hand.length + p.deck.length);
    assert.equal(v.players[RAF].handCount, 4);
    assert.ok(Array.isArray(s.view(LW).players[LW].hand), 'the bot sees its own hand');
    assert.equal(s.view(LW).players[LW].hidden, null);
    assert.equal(s.view(LW).players[RAF].hand, null);
    assert.ok(!s.state.notes[RAF].some((e) => e.k === 'drew'), 'no notes of cards it did not really draw');
    const plain = new Session({ scenario: 1, seed: 'v' }).view(RAF);
    assert.equal(plain.external, null);
    assert.ok(Array.isArray(plain.players[RAF].hand));
});

test('the bid offers any card the player may hold; the one bid is found even if the engine had it in the deck', () => {
    const s = new Session({ scenario: 1, seed: 'b', external: RAF });
    const req = s.pending;
    assert.equal(req.kind, 'bid');
    assert.equal(req.seat, RAF);
    const p = s.state.players[RAF];
    assert.deepEqual(new Set(req.options.map((o) => o.id.slice(4))), new Set(types([...p.hand, ...p.deck])));
    const inDeck = p.deck.find((c) => !p.hand.some((h) => type(h) === type(c)));
    s.act(`bid:${type(inDeck)}`);
    assert.equal(type(p.bid), type(inDeck));
    assert.ok(p.hand.includes(p.bid), 'the bid is in hand until both are revealed');
    assert.equal(s.view(LW).players[RAF].bid, null, 'the bot never sees it');
});

test('play: offers the cards of hand + deck, never the discard pile; counts stay right', () => {
    const g = ext();
    const p = g.players[RAF];
    split(g, RAF, ['R1', 'commsY', 'discord']);
    const offered = () => new Set(playerTurn(g, RAF).next().value.options.map((o) => o.id));
    assert.ok(offered().has('play:Y1') && offered().has('play:G1'), 'cards the engine had in the deck');
    assert.ok(!offered().has('play:discord'), 'a Discord is never played');
    // a G1 only in the discard pile is not offered
    p.discard.push(...p.deck.splice(p.deck.findIndex((c) => type(c) === 'G1'), 1));
    assert.ok(!offered().has('play:G1'));
    // the player holds the Y1 (the engine thought it was in the deck): it is found, the deck keeps its size
    const deck = p.deck.length;
    drive(playerTurn(g, RAF), ['play:Y1', 'move', 'fwd', '?stop', 'end', 'card:R1', 'card:discord']);
    assert.equal(p.deck.length, deck);
    assert.ok(p.discard.some((c) => type(c) === 'Y1'));
});

test('end of turn with cards left: the player says which go to the discard pile, one at a time', () => {
    const g = ext();
    split(g, RAF, ['commsY', 'discord', 'discord']);
    const asked = drive(playerTurn(g, RAF), ['end', 'card:discord', 'card:commsG', 'card:Y1']);
    const left = asked.filter((r) => r.kind === 'leftover');
    assert.deepEqual(left.map((r) => r.left), [3, 2, 1]);
    assert.ok(left.every((r) => r.seat === RAF));
    const p = g.players[RAF];
    assert.equal(p.hand.length, 0);
    assert.equal(p.deck.length, 9, 'the cards the engine had in hand went back to the deck');
    assert.deepEqual(types(p.discard), ['Y1', 'commsG', 'discord']);
    assert.deepEqual(g.log.findLast((e) => e.k === 'leftover').cards, ['raf:discord', 'raf:commsG', 'raf:Y1'], 'in the order named');
});

test('Coordinate: offered while a Discord may be in hand; it is found where the engine had it', () => {
    const g = ext();
    const p = g.players[RAF];
    split(g, RAF, ['sqn', 'R1']); // both Discords in the deck
    const coordinate = (r) => r.options.find((o) => o.action === 'coordinate').id;
    drive(playerTurn(g, RAF), ['play:sqn', coordinate, 'end', first]);
    assert.deepEqual(types(p.aside), ['discord']);
    assert.ok(g.log.some((e) => e.k === 'coordinate'));
    // with the hand down to the comms card itself, no Discord can be in hand
    const g2 = ext();
    split(g2, RAF, ['sqn']);
    const req = drive(playerTurn(g2, RAF), ['play:sqn', 'dark']).find((r) => r.kind === 'comms');
    assert.ok(!req.options.some((o) => o.action === 'coordinate'));
    // nor with every Discord in the discard pile
    const g3 = ext();
    split(g3, RAF, ['sqn', 'R1']);
    const p3 = g3.players[RAF];
    for (const c of p3.deck.filter((x) => type(x) === 'discord')) p3.discard.push(...p3.deck.splice(p3.deck.indexOf(c), 1));
    const req3 = drive(playerTurn(g3, RAF), ['play:sqn', 'dark', 'end', first]).find((r) => r.kind === 'comms');
    assert.ok(!req3.options.some((o) => o.action === 'coordinate'));
});

test('dice: the external player says hit or miss for their attacks; the bot rolls its own unless told', () => {
    for (const botDice of ['virtual', 'physical']) {
        const g = ext(1, { botDice });
        const raf = g.aircraft['raf:R1'];
        const lw = g.aircraft['luftwaffe:Y1'];
        lw.hex = raf.hex; // same hex: always in a firing line, range 0
        split(g, RAF, ['R1']);
        const lwp = g.players[LW];
        lwp.hand.push(...lwp.deck.splice(lwp.deck.findIndex((c) => type(c) === 'Y1'), 1)); // the hit takes it, no shuffle
        const rng = g.rng;
        const asked = drive(playerTurn(g, RAF), ['play:R1', 'actFirst', '?attack:luftwaffe:Y1', 'hit', 'fwd', '?stop']);
        const roll = asked.find((r) => r.kind === 'roll');
        assert.deepEqual([roll.seat, roll.attacker, roll.target, roll.type], [RAF, RAF, 'luftwaffe:Y1', 'attack']);
        assert.equal(roll.total, roll.defence + roll.cover + roll.range);
        assert.deepEqual(roll.options.map((o) => o.id), ['hit', 'miss']);
        assert.equal(g.rng, rng, 'no die rolled by the engine');
        const combat = g.log.findLast((e) => e.k === 'combat');
        assert.equal(combat.dice, null);
        assert.ok(combat.success);
        assert.ok(g.log.some((e) => e.k === 'hit' && e.aircraft === 'luftwaffe:Y1' && e.from === 'hand'), 'the bot loses its card by itself');
        // the Luftwaffe bot attacks back (the R1 has no card left outside the play area: no question)
        lwp.hand = [];
        fromSupply(g, LW, 'Y1', 'hand');
        lw.hex = raf.hex;
        const back = drive(playerTurn(g, LW), ['play:Y1', 'actFirst', '?attack:raf:R1', ...(botDice === 'physical' ? ['miss'] : []), 'fwd', '?stop']);
        const r = back.find((x) => x.kind === 'roll');
        assert.equal(Boolean(r), botDice === 'physical');
        if (r) assert.deepEqual([r.seat, r.attacker], [RAF, LW]);
    }
});

test('casualty: the external player says where the card comes from, among the places the rules allow', () => {
    const g = ext();
    const p = g.players[RAF];
    const a = g.aircraft['raf:R1'];
    const where = () => casualtyFrom(g, a);
    split(g, RAF, ['commsY', 'discord']); // the R1 in the deck: the player may still have it in hand
    assert.deepEqual(where(), ['hand', 'deck']);
    fromSupply(g, RAF, 'R1', 'discard');
    assert.deepEqual(where(), ['hand', 'discard'], 'with one in the discard pile, never the deck');
    p.supply.push(...p.discard.splice(0));
    // "from the hand" when the engine had it in the deck: the deck keeps its size, the hand loses one
    const [hand, deck] = [p.hand.length, p.deck.length];
    hit(g, a, 'hand');
    assert.deepEqual([p.hand.length, p.deck.length], [hand - 1, deck]);
    assert.equal(g.log.at(-1).from, 'hand');
    assert.deepEqual(where(), [], 'no more: the next hit neutralises it');
    hit(g, a);
    assert.equal(a.status, 'neutralised');
});

test('a hit on the external player asks where the card comes from; the bot never answers it', () => {
    const g = ext();
    const raf = g.aircraft['raf:R1'];
    g.aircraft['luftwaffe:Y1'].hex = raf.hex;
    split(g, RAF, ['commsY']);
    fromSupply(g, LW, 'Y1', 'hand');
    for (let i = 0; i < 40; i++) {
        const t = structuredClone(g);
        t.rng = (g.rng + i * 7919) >>> 0;
        let asked;
        try {
            asked = drive(playerTurn(t, LW), ['play:Y1', 'actFirst', '?attack:raf:R1', 'from:deck', 'fwd', '?stop']);
        } catch {
            continue; // a miss: no casualty question
        }
        const c = asked.find((r) => r.kind === 'casualty');
        assert.equal(c.seat, RAF);
        assert.equal(c.aircraft, 'raf:R1');
        assert.deepEqual(c.options.map((o) => o.id), ['from:hand', 'from:deck']);
        assert.equal(t.log.findLast((e) => e.k === 'hit').from, 'deck');
        return;
    }
    assert.fail('no hit in 40 tries');
});

test('whole games: a random external player against the bot, every card kept, codes replay', () => {
    for (const sc of SCENARIOS) {
        for (const [seat, botDice] of [[RAF, 'virtual'], [LW, 'physical']]) {
            const s = new Session({ scenario: sc.id, seed: `x${sc.id}${seat}`, external: seat, botDice });
            const start = cardCount(s.state);
            const bots = [0, 1].map((k) => (k === seat ? randomBot(`r${sc.id}`) : heuristicBot(`h${sc.id}`)));
            playOut(s, bots, {
                check: (g) => {
                    assert.deepEqual(cardCount(g), start);
                    const r = g.pending;
                    if (r && ['roll', 'casualty', 'leftover'].includes(r.kind)) assert.equal(r.seat, seat);
                    if (r && r.seat === seat && ['bid', 'play'].includes(r.kind)) {
                        const pool = new Set(handPool(g, seat).map(type));
                        for (const o of r.options) if (o.id.includes(':')) assert.ok(pool.has(o.id.split(':')[1]), `${o.id} is among hand + deck`);
                    }
                },
            });
            assert.ok(s.state.result, `scenario ${sc.id}: the game ends`);
            const r = replayRecord(makeRecord(s));
            assert.ok(r.matches);
            assert.equal(fingerprint(r.session.state), fingerprint(s.state));
        }
    }
});
