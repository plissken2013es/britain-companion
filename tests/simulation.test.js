import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/engine/session.js';
import { SCENARIOS } from '../src/engine/data.js';
import { randomBot } from '../src/ai/randomBot.js';
import { playOut, cardCount } from './helpers.js';

const GAMES = Number(process.env.SIM_GAMES ?? 20);

for (const s of SCENARIOS) {
    test(`scenario ${s.id}: ${GAMES} random games end without errors and keep every card`, () => {
        for (let i = 0; i < GAMES; i++) {
            const session = new Session({ scenario: s.id, seed: `sim${i}` });
            const total = cardCount(session.state);
            playOut(session, [randomBot(`a${i}`), randomBot(`b${i}`)], {
                check: (g) => {
                    assert.deepEqual(cardCount(g), total);
                    for (const a of Object.values(g.aircraft)) if (a.status === 'board') assert.ok(a.facing >= 0 && a.facing < 6);
                },
            });
            assert.ok(session.state.result, 'game ended');
        }
    });
}

test('replaying the answers rebuilds the same game', () => {
    const a = new Session({ scenario: 1, seed: 'rep' });
    playOut(a, [randomBot('x'), randomBot('y')], { max: 300 });
    const b = new Session({ scenario: 1, seed: 'rep' }, a.answers);
    assert.deepEqual(b.state.aircraft, a.state.aircraft);
    assert.deepEqual(b.state.players, a.state.players);
});
