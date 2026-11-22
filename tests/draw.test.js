// The draw ([D-12], [D-20]): canWin is an upper bound, so the game ends in a draw only when neither side can win.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/engine/session.js';
import { createState, normalizeSetup, canWin, checkWin } from '../src/engine/state.js';
import { GameEnd } from '../src/engine/ask.js';
import { SCENARIOS, typeOf } from '../src/engine/data.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { randomBot } from '../src/ai/randomBot.js';
import { playOut } from './helpers.js';

const fresh = (scenario) => createState(normalizeSetup({ scenario, seed: 'draw' }));

/** Takes every combat card of a side out of the game, as hits would. */
function disarm(g, seat) {
    const p = g.players[seat];
    for (const z of ['deck', 'hand', 'discard', 'play', 'supply']) {
        p.removed.push(...p[z].filter((c) => typeOf(c).kind === 'combat'));
        p[z] = p[z].filter((c) => typeOf(c).kind !== 'combat');
    }
}

const endsInDraw = (g) => {
    try {
        checkWin(g);
    } catch (e) {
        if (!(e instanceof GameEnd)) throw e;
        return g.result;
    }
    return null;
};

test('every side can win at the start of every scenario', () => {
    for (const s of SCENARIOS) {
        const g = fresh(s.id);
        assert.ok(canWin(g, 0) && canWin(g, 1), `scenario ${s.id}`);
    }
});

test('no Attack or Bomb card left on either side (and no balloon): draw', () => {
    const g = fresh(1);
    disarm(g, 0);
    assert.ok(!canWin(g, 0));
    assert.equal(endsInDraw(g), null, 'the Luftwaffe can still win');
    disarm(g, 1);
    const r = endsInDraw(g);
    assert.equal(r.winner, null);
    assert.equal(r.how, 'draw');
});

test('a barrage balloon keeps the neutralise objective alive without weapons', () => {
    const g = fresh(4);
    disarm(g, 0);
    assert.ok(canWin(g, 0), 'Luftwaffe aircraft can still fly into a balloon');
    for (const m of g.markers) if (m.type === 'balloon') m.status = 'destroyed';
    assert.ok(!canWin(g, 0));
});

test('scenario 8: too few aircraft left to escape, and nothing left for the RAF to neutralise', () => {
    const g = fresh(8);
    const lw = Object.values(g.aircraft).filter((a) => a.seat === 1);
    lw.forEach((a, i) => (a.status = i ? 'escaped' : 'board'));
    assert.ok(canWin(g, 1), 'one live aircraft and the escaped ones still make two');
    lw[0].status = 'escaped';
    assert.ok(!canWin(g, 1), 'the Luftwaffe has escaped but cannot neutralise any more');
    assert.ok(!canWin(g, 0), 'no Luftwaffe aircraft left to neutralise');
    assert.equal(endsInDraw(g).how, 'draw');
});

test('points (scenario 9): what is left on the board counts', () => {
    const g = fresh(9);
    disarm(g, 1);
    assert.ok(!canWin(g, 1), 'no bombs and no attacks: no more points');
});

// Soundness over real games: once canWin says a side cannot win, that side never wins afterwards.
test('in whole games a side ruled out never wins', () => {
    for (const s of SCENARIOS) {
        for (let i = 0; i < 3; i++) {
            const out = [false, false];
            const session = new Session({ scenario: s.id, seed: `dr${s.id}-${i}`, maxRounds: 60 });
            const bots = i === 2 ? [randomBot(`r${i}`), heuristicBot(`l${i}`)] : [heuristicBot(`r${i}`), heuristicBot(`l${i}`)];
            playOut(session, bots, {
                check: (g) => {
                    if (g.result) return;
                    for (const seat of [0, 1]) if (!canWin(g, seat)) out[seat] = true;
                },
            });
            const r = session.state.result;
            if (r.winner != null) assert.ok(!out[r.winner], `scenario ${s.id} game ${i}: seat ${r.winner} won after being ruled out`);
        }
    }
});
