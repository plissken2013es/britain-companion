import { test } from 'node:test';
import assert from 'node:assert/strict';
import cards from '../src/data/cards.json' with { type: 'json' };
import { SCENARIOS, nameToType, unitToType, TYPES, counterOf } from '../src/engine/data.js';
import { boardFrom, tileHexes, key } from '../src/engine/hex.js';
import { createState, normalizeSetup } from '../src/engine/state.js';

test('card totals match the rulebook (51 RAF, 65 Luftwaffe)', () => {
    const total = (side) => cards[side].reduce((n, c) => n + c.copies, 0);
    assert.equal(total('raf'), 51);
    assert.equal(total('luftwaffe'), 65);
    assert.equal(cards.raf.length, 20);
    assert.equal(cards.luftwaffe.length, 22);
});

test('every combat card has a counter', () => {
    for (const t of Object.values(TYPES)) if (t.kind === 'combat') assert.ok(counterOf(t.key).defence > 0, t.key);
});

for (const s of SCENARIOS) {
    test(`scenario ${s.id} is consistent`, () => {
        const board = boardFrom(s.hexes);
        for (const t of s.tiles) for (const h of tileHexes(t)) assert.ok(board.has(h), `tile ${t.id} hex ${h} off the board`);
        assert.deepEqual(s.tiles.map((t) => t.id).sort(), [...s.landTiles].sort(), 'land tiles table');
        const seen = new Set();
        for (const tok of s.tokens) {
            assert.ok(board.has(key(...tok.hex)), `${tok.type} ${tok.unit ?? ''} off the board`);
            if (tok.type !== 'aircraft') continue;
            const id = `${tok.side}:${unitToType(tok.unit)}`;
            assert.ok(TYPES[id], `unknown aircraft ${id}`);
            assert.ok(!seen.has(id), `duplicate aircraft ${id}`);
            seen.add(id);
        }
        // the card table only names known cards, and every aircraft on the board has cards
        const types = new Set();
        for (const side of ['raf', 'luftwaffe']) for (const name of Object.keys(s.cards[side] ?? {})) types.add(`${side}:${nameToType(side, name)}`);
        for (const id of seen) assert.ok(types.has(id), `aircraft ${id} has no cards`);
        assert.ok(s.win?.raf?.length && s.win?.luftwaffe?.length, 'machine objectives');
    });
}

test('counters as printed: aces one more defence; anti-aircraft artillery 6', () => {
    assert.equal(counterOf('raf:Y1').defence, 5);
    assert.equal(counterOf('raf:Yace').defence, 6);
    assert.equal(counterOf('luftwaffe:Bace').defence, 6);
    assert.equal(counterOf('raf:G1').defence, 4);
    assert.deepEqual(counterOf('luftwaffe:G1').lines, ['F']);
    const g = createState(normalizeSetup({ scenario: 11, seed: 'c' }));
    assert.ok(g.markers.filter((m) => m.type === 'aaa').every((m) => m.defence === 6));
});
