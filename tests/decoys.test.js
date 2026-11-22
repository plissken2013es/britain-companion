// Scenario 9 decoys ([D-14], [D-19]): setup, moving in pairs, revealing, comms, and above all that the RAF never
// learns which counter is the decoy until the rules reveal it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/engine/session.js';
import { createState, normalizeSetup, hit, outOfComms, decoyOf, objectiveMet } from '../src/engine/state.js';
import { flyCard } from '../src/engine/turn.js';
import { view } from '../src/engine/view.js';
import { heuristicBot } from '../src/ai/heuristicBot.js';
import { randomBot } from '../src/ai/randomBot.js';

const N = 0, S = 3;

function deployed(seed = 'd') {
    const g = createState(normalizeSetup({ scenario: 9, seed }));
    // put the eight counters on the deploy hexes in a fixed order
    const lw = Object.values(g.aircraft).filter((a) => a.seat === 1);
    lw.forEach((a, i) => Object.assign(a, { hex: g.deploy[i], facing: S, status: 'board' }));
    return g;
}

function drive(gen, answers) {
    const asked = [];
    let r = gen.next();
    while (!r.done) {
        if (r.value.type === 'beat') {
            r = gen.next();
            continue;
        }
        asked.push(r.value);
        const a = answers.shift();
        r = gen.next(typeof a === 'function' ? a(r.value) : a);
    }
    return asked;
}

test('setup: four decoys with random public aliases, deployed by the Luftwaffe', () => {
    const g = createState(normalizeSetup({ scenario: 9, seed: 'x' }));
    const decoys = Object.values(g.aircraft).filter((a) => a.decoy);
    assert.equal(decoys.length, 4);
    assert.ok(decoys.every((d) => d.status === 'deploy'));
    assert.equal(new Set(Object.values(g.alias)).size, 8);
    // over several seeds the real aircraft is sometimes @1 and sometimes @2
    const firsts = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => createState(normalizeSetup({ scenario: 9, seed: s })).alias['luftwaffe:G1']));
    assert.equal(firsts.size, 2);
    const session = new Session({ scenario: 9, seed: 'x' });
    assert.equal(session.pending.kind, 'deploy');
    assert.equal(session.pending.seat, 1);
});

test('the RAF view shows both counters of a pair the same way', () => {
    const g = deployed();
    const v = view(g, 0);
    const text = JSON.stringify(v);
    assert.ok(!text.includes('~'), 'no decoy ids');
    assert.ok(!text.includes('"decoy"'), 'no decoy flags');
    assert.ok(v.aircraft['luftwaffe:G1@1'] && v.aircraft['luftwaffe:G1@2']);
    const own = view(g, 1);
    assert.ok(own.aircraft['luftwaffe:G1~'].decoy);
});

test('playing the card moves the aircraft and then its decoy, independently', () => {
    const g = deployed();
    const real = g.aircraft['luftwaffe:G1'];
    const twin = g.aircraft['luftwaffe:G1~'];
    const [r0, t0] = [real.hex, twin.hex];
    // BF 110C moves 2: the first step of each counter is forced, then each one decides on its own
    const asked = drive(flyCard(g, 1, 'luftwaffe:G1:1'), ['move', 'stop', 'fwd']);
    assert.deepEqual(asked.filter((r) => r.kind === 'move').map((r) => r.aircraft), ['luftwaffe:G1', 'luftwaffe:G1~']);
    assert.notEqual(real.hex, r0);
    assert.notEqual(twin.hex, t0);
    assert.equal(Math.abs(Number(twin.hex.split(',')[1]) - Number(t0.split(',')[1])), 4);
});

test('a hit on a decoy reveals it and costs nothing; a hit on the aircraft removes its decoy first', () => {
    const g = deployed();
    const p = g.players[1];
    const cards = () => p.hand.length + p.deck.length + p.discard.length;
    const before = cards();
    hit(g, g.aircraft['luftwaffe:H1~']);
    assert.equal(g.aircraft['luftwaffe:H1~'].status, 'removed');
    assert.equal(cards(), before);
    hit(g, g.aircraft['luftwaffe:H2']);
    assert.equal(g.aircraft['luftwaffe:H2~'].status, 'removed');
    assert.equal(cards(), before - 1);
    const lw = g.log.filter((e) => e.k === 'decoyRemoved');
    assert.deepEqual(lw.map((e) => e.why), ['revealed', 'paired']);
    assert.ok(lw.every((e) => e.aircraft.includes('@')), 'the log uses public ids');
    // a removed decoy does not count for the RAF objective
    g.aircraft['luftwaffe:G1~'].status = 'removed';
    assert.ok(!objectiveMet(g, 0));
});

test('section G stays in comms while one of its decoys is on the board', () => {
    const g = deployed();
    g.aircraft['luftwaffe:G1'].hex = g.deploy[0];
    g.aircraft['luftwaffe:G2'].hex = g.deploy[7];
    assert.ok(!outOfComms(g, 1, 'G'));
    g.aircraft['luftwaffe:G1~'].status = 'removed';
    g.aircraft['luftwaffe:G2~'].status = 'removed';
    assert.ok(outOfComms(g, 1, 'G'));
});

test('a combat action by the aircraft removes its decoy', () => {
    const g = deployed();
    const real = g.aircraft['luftwaffe:H1'];
    const raf = Object.values(g.aircraft).find((a) => a.seat === 0 && a.ready);
    Object.assign(raf, { hex: real.hex, facing: N });
    drive(flyCard(g, 1, 'luftwaffe:H1:1'), ['actFirst', (req) => req.options[0].id]);
    assert.equal(decoyOf(g, real), null);
});

test('in whole games the RAF never sees a decoy id or flag before it is revealed', () => {
    for (let i = 0; i < 6; i++) {
        const session = new Session({ scenario: 9, seed: `hid${i}`, maxRounds: 40 });
        const bots = [heuristicBot(`r${i}`), i % 2 ? randomBot(`l${i}`) : heuristicBot(`l${i}`)];
        while (!session.over) {
            const req = session.pending;
            const v = session.view(req.seat);
            if (req.seat === 0) {
                const live = Object.values(v.aircraft).filter((a) => a.seat === 1 && a.status === 'board');
                assert.ok(!JSON.stringify(live).includes('decoy') && !JSON.stringify(live).includes('~'));
                assert.ok(!JSON.stringify(req).includes('~'), `request ${req.kind}`);
            }
            session.act(bots[req.seat](req, v));
        }
        assert.ok(!session.state.log.some((e) => JSON.stringify(e).includes('~')));
    }
});

test('the bot deploys facing the targets in the west, real aircraft and decoys mixed over the deploy hexes', () => {
    const realHexes = new Set();
    for (const seed of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) {
        const s = new Session({ scenario: 9, seed });
        const bots = [heuristicBot('a' + seed), heuristicBot('b' + seed)];
        while (s.pending && (s.pending.kind === 'deploy' || s.pending.kind === 'facing')) s.act(bots[s.pending.seat](s.pending, s.view(s.pending.seat)));
        for (const a of Object.values(s.state.aircraft).filter((x) => x.seat === 1)) {
            assert.ok(![1, 2].includes(a.facing), `${a.id} faces east (${a.facing})`); // NE or SE: off the board
            if (!a.id.endsWith('~')) realHexes.add(a.hex);
        }
    }
    assert.ok(realHexes.size >= 6, `real aircraft always on the same hexes: ${[...realHexes]}`);
});

test('the deploy does not give away the real counter: the RAF sees nothing until all are down, then them by alias', () => {
    // the real aircraft are placed before their decoys; logged in that order, the first of each pair was the real one
    // (160 of 160 pairs in 40 games before the fix)
    for (const seed of ['o1', 'o2', 'o3', 'o4', 'o5']) {
        const s = new Session({ scenario: 9, seed });
        const bot = heuristicBot(seed);
        let sawDeploying = false;
        while (s.state.phase === 'setup') {
            const v = s.view(0);
            const lw = Object.values(v.aircraft).filter((a) => a.seat === 1);
            if (lw.some((a) => a.status === 'board' || a.hex != null)) sawDeploying = true;
            s.act(bot(s.pending, s.view(s.pending.seat)));
        }
        assert.equal(sawDeploying, false, `${seed}: the RAF saw a counter while the Luftwaffe deployed`);
        const order = s.view(0).log.filter((e) => e.k === 'deployed').map((e) => e.aircraft);
        assert.equal(order.length, 8);
        assert.deepEqual(order, [...order].sort());
    }
});
