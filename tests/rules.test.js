// Rules with forced positions on scenario 1's board (12 columns, d 0–16). Each test builds a state, moves pieces
// where it needs them and drives one engine generator with scripted answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, normalizeSetup, hit, outOfComms, objectiveMet } from '../src/engine/state.js';
import { attackTargets, antiAirTargets, resolve } from '../src/engine/combat.js';
import { flyCard, moveAircraft, playerTurn, bolsterBlock } from '../src/engine/turn.js';
import { GameEnd } from '../src/engine/ask.js';
import { TYPES, SCENARIOS } from '../src/engine/data.js';

const fresh = (scenario = 1) => createState(normalizeSetup({ scenario, seed: 'rules' }));
const N = 0, NE = 1, SE = 2, S = 3, SW = 4, NW = 5;

/** Puts an aircraft at a hex with a facing (ready by default). */
function place(g, id, hex, facing, extra = {}) {
    Object.assign(g.aircraft[id], { hex, facing, status: 'board', ready: true, ...extra });
    return g.aircraft[id];
}

/** Parks every aircraft not named in a far corner so it does not get in the way. */
function clear(g, keep) {
    let d = 0;
    for (const a of Object.values(g.aircraft)) if (!keep.includes(a.id)) Object.assign(a, { hex: `11,${(d += 2) - 1}`, facing: N });
}

/** Runs a generator, answering requests in order (strings or functions of the request); returns the requests. */
function drive(gen, answers) {
    const asked = [];
    let r = gen.next();
    while (!r.done) {
        if (r.value.type === 'beat') {
            r = gen.next();
            continue;
        }
        asked.push(r.value);
        if (!answers.length) throw new Error(`unanswered ${r.value.kind}: ${r.value.options.map((o) => o.id).join(' ')}`);
        const a = answers.shift();
        r = gen.next(typeof a === 'function' ? a(r.value) : a);
    }
    return asked;
}

const ATTACK_2_3 = { value: 2, rear: 3 };

test('attack: base defence + cover + range, rear from behind (rulebook p21 example)', () => {
    const g = fresh();
    clear(g, ['luftwaffe:Y2', 'luftwaffe:Y1', 'raf:G1']);
    const y2 = place(g, 'luftwaffe:Y2', '5,5', S);
    place(g, 'luftwaffe:Y1', '5,7', S); // between them: +1 cover
    place(g, 'raf:G1', '5,9', S); // facing away from the attacker
    const [t] = attackTargets(g, y2, ATTACK_2_3);
    assert.equal(t.target, 'raf:G1');
    assert.equal(t.range, 2);
    assert.equal(t.cover, 1);
    assert.equal(t.total, 4 + 1 + 2);
    assert.ok(t.rear);
    assert.equal(t.dice, 3);
});

test('attack: head-on is not rear; clouds add 2; only along the firing lines', () => {
    const g = fresh();
    clear(g, ['luftwaffe:Y2', 'raf:R1']);
    const y2 = place(g, 'luftwaffe:Y2', '5,5', S);
    place(g, 'raf:R1', '5,11', N);
    g.markers.push({ id: 'c1', type: 'cloud', hex: '5,9', status: 'board' });
    let [t] = attackTargets(g, y2, ATTACK_2_3);
    assert.equal(t.total, 5 + 2 + 3); // Hurricane 1 defence 5, cloud, range 3
    assert.ok(!t.rear);
    assert.equal(t.dice, 2);
    place(g, 'raf:R1', '6,10', N); // not on the nose line
    assert.equal(attackTargets(g, y2, ATTACK_2_3).length, 0);
    // same hex is always in the firing line, never rear (D-2)
    place(g, 'raf:R1', '5,5', S);
    [t] = attackTargets(g, y2, ATTACK_2_3);
    assert.equal(t.range, 0);
    assert.ok(!t.rear);
});

test('attack: grounded RAF aircraft cannot be attacked, suppressed Luftwaffe can', () => {
    const g = fresh();
    clear(g, ['luftwaffe:Y2', 'raf:R1', 'raf:R2']);
    const y2 = place(g, 'luftwaffe:Y2', '5,5', S);
    place(g, 'raf:R1', '5,7', N, { ready: false });
    assert.equal(attackTargets(g, y2, ATTACK_2_3).length, 0);
    const r2 = place(g, 'raf:R2', '5,9', S);
    place(g, 'luftwaffe:Y2', '5,13', N, { ready: false });
    assert.equal(attackTargets(g, r2, ATTACK_2_3)[0].target, 'luftwaffe:Y2');
});

test('anti-air needs an AAA marker and measures range from the closest one (D-4)', () => {
    const g = fresh();
    assert.equal(antiAirTargets(g, 0, { value: 3 }).length, 0);
    g.markers.push({ id: 'g1', type: 'aaa', hex: '2,8', status: 'board' });
    const t = antiAirTargets(g, 0, { value: 3 }).find((o) => o.target === 'luftwaffe:R2');
    assert.equal(t.range, 3); // R2 starts at 2,2
    assert.equal(t.total, 5 + 3);
});

test('a hit removes a card from hand, then discard, then deck; then the aircraft is neutralised', () => {
    const g = fresh();
    const p = g.players[0];
    const a = g.aircraft['raf:Y1'];
    const mine = (z) => p[z].filter((c) => c.startsWith('raf:Y1:'));
    // scenario 1: one Y1 in the deck, two in the supply; give it one in hand and one in the discard
    p.hand.push(p.supply.splice(p.supply.indexOf(mine('supply')[0]), 1)[0]);
    p.discard.push(p.supply.splice(p.supply.indexOf(mine('supply')[0]), 1)[0]);
    hit(g, a);
    assert.equal(mine('hand').length, 0);
    assert.equal(mine('discard').length, 1);
    hit(g, a);
    assert.equal(mine('discard').length, 0);
    assert.equal(mine('deck').length, 1);
    hit(g, a);
    assert.equal(mine('deck').length, 0);
    assert.equal(a.status, 'board');
    assert.equal(p.removed.length, 3);
    p.supply.push('raf:Y1:9');
    hit(g, a);
    assert.equal(a.status, 'neutralised');
    assert.equal(mine('supply').length, 0);
});

test('out of comms: more than one hex apart, or a section mate neutralised', () => {
    const g = fresh();
    assert.ok(!outOfComms(g, 0, 'R')); // R1 0,12 and R2 0,14
    g.aircraft['raf:R2'].hex = '0,16';
    assert.ok(outOfComms(g, 0, 'R'));
    g.aircraft['raf:R2'].hex = '1,13';
    assert.ok(!outOfComms(g, 0, 'R'));
    g.aircraft['raf:R2'].status = 'neutralised';
    assert.ok(outOfComms(g, 0, 'R'));
});

test('move: turns only after a hex, never twice in a row, and Move is mandatory', () => {
    const g = fresh();
    clear(g, ['raf:Y1']);
    const a = place(g, 'raf:Y1', '4,10', N);
    // the first step is forced (a single option answers itself)
    const asked = drive(moveAircraft(g, 0, a, 2, 2, false), ['left', 'fwd', 'stop']);
    assert.deepEqual(asked[0].options.map((o) => o.id), ['fwd', 'left', 'right', 'stop']);
    assert.deepEqual(asked[1].options.map((o) => o.id), ['fwd', 'stop']);
    assert.deepEqual(asked[2].options.map((o) => o.id), ['left', 'right', 'stop']);
    assert.equal(a.hex, '3,7');
    assert.equal(a.facing, NW);
});

test('move: an ace may turn before moving', () => {
    const g = fresh();
    const a = place(g, 'raf:Y1', '4,10', N);
    const asked = drive(moveAircraft(g, 0, a, 2, 2, true), ['right', 'stop']);
    assert.deepEqual(asked[0].options.map((o) => o.id), ['fwd', 'left', 'right']);
    assert.equal(a.hex, '5,9');
});

test('move: the board edge turns the aircraft, gives a Discord and forbids the card action', () => {
    const g = fresh();
    clear(g, ['raf:R1', 'luftwaffe:R1']);
    const a = place(g, 'raf:R1', '0,12', SW);
    place(g, 'luftwaffe:R1', '0,10', S);
    g.players[0].play.push('raf:R1:9');
    const discords = () => g.players[0].discard.filter((c) => c.startsWith('raf:discord')).length;
    // plan: move then act; the first step leaves the board
    const asked = drive(flyCard(g, 0, 'raf:R1:1'), ['moveThenAct', 'fwd', 'right']);
    assert.equal(a.hex, '0,12');
    assert.equal(a.facing, NW);
    assert.equal(discords(), 1);
    assert.ok(!asked.some((r) => r.kind === 'combat'));
});

test('move: flying into a barrage balloon neutralises the aircraft', () => {
    const g = fresh();
    const a = place(g, 'raf:Y1', '4,10', N);
    g.markers.push({ id: 'b1', type: 'balloon', hex: '4,8', status: 'board' });
    drive(moveAircraft(g, 0, a, 2, 0, false), ['fwd']);
    assert.equal(a.status, 'neutralised');
    assert.equal(g.players[0].deck.filter((c) => c.startsWith('raf:Y1:')).length, 0);
});

test('an out-of-action counter is readied instead of moving', () => {
    const g = fresh();
    const a = place(g, 'raf:Y1', '4,10', N, { ready: false });
    const asked = drive(flyCard(g, 0, 'raf:Y1:1'), []);
    assert.equal(asked.length, 0);
    assert.ok(a.ready);
    assert.equal(a.hex, '4,10');
});

test('objectives: scenario 1, the RAF wins on the second neutralised enemy', () => {
    const g = fresh();
    g.aircraft['luftwaffe:R1'].status = 'neutralised';
    assert.ok(!objectiveMet(g, 0));
    g.aircraft['luftwaffe:R2'].status = 'neutralised';
    assert.ok(objectiveMet(g, 0));
    assert.ok(!objectiveMet(g, 1));
});

test('a successful attack that neutralises the last needed enemy ends the game', () => {
    const g = fresh();
    g.aircraft['luftwaffe:R1'].status = 'neutralised';
    const p = g.players[1];
    for (const z of ['deck', 'supply', 'hand', 'discard']) p[z] = p[z].filter((c) => !c.startsWith('luftwaffe:R2:'));
    g.turn = 0;
    // force the dice: total 2 always succeeds
    const opt = { target: 'luftwaffe:R2', total: 2, dice: 3, range: 1, cover: 0, rear: false };
    assert.throws(() => drive(resolve(g, 0, 'attack', opt, 'raf:Y1'), []), GameEnd);
    assert.deepEqual(g.result, { winner: 0, how: 'objective', round: 0 });
});

test('Section Comms: out of comms gives a Discord on Bolster; Coordinate is blocked', () => {
    const g = fresh();
    g.aircraft['raf:R2'].hex = '0,16';
    const p = g.players[0];
    p.hand = ['raf:commsR:1', 'raf:discord:1'];
    p.deck = p.deck.filter((c) => !p.hand.includes(c));
    const before = p.discard.length;
    const asked = drive(playerTurn(g, 0), ['play:commsR', (req) => req.options.find((o) => o.action === 'bolster').id, 'take:R1', 'done', 'end']);
    const comms = asked.find((r) => r.kind === 'comms');
    assert.ok(!comms.options.some((o) => o.action === 'coordinate'));
    assert.ok(comms.options.find((o) => o.action === 'bolster').discord);
    // bolstered R1 + a Discord + (end of turn) the comms card and the Discord left in hand
    assert.equal(p.discard.length - before, 4);
    assert.ok(TYPES['raf:commsR'].initiativeIcon === 'discord');
});

test('Bolster never offers a Discord (D-22): with only Discord in the supply there is no Bolster', () => {
    const g = fresh();
    const p = g.players[0];
    const sqn = [...p.deck, ...p.hand].find((c) => c.startsWith('raf:sqn:'));
    p.deck = p.deck.filter((c) => c !== sqn);
    p.hand = [sqn];
    const r1 = p.supply.find((c) => c.startsWith('raf:R1:'));
    p.supply = p.supply.filter((c) => c.startsWith('raf:discord:'));
    const asked = drive(playerTurn(g, 0), ['play:sqn', 'dark', 'end']);
    const comms = asked.find((r) => r.kind === 'comms');
    assert.ok(!comms.options.some((o) => o.action === 'bolster'));
    // the interface is told why, to show it greyed
    assert.deepEqual(comms.blocked.map((b) => b.reason), ['discord']);
    assert.equal(bolsterBlock([], { type: 'bolster', value: 3 }), 'empty');
    assert.equal(bolsterBlock([r1], { type: 'bolster', value: 2, section: 'Y' }), 'section');
    assert.equal(bolsterBlock([r1], { type: 'bolster', value: 2, section: 'R' }), null);
    // with an R1 there too, Bolster takes it and stops: the Discord is never on offer
    const h = fresh();
    const q = h.players[0];
    q.deck = q.deck.filter((c) => c !== sqn);
    q.hand = [sqn];
    q.supply = [r1, ...q.supply.filter((c) => c.startsWith('raf:discord:'))];
    const again = drive(playerTurn(h, 0), ['play:sqn', (req) => req.options.find((o) => o.action === 'bolster').id, 'end']);
    assert.ok(!again.some((r) => r.kind === 'bolster' && r.options.some((o) => o.id === 'take:discord')));
    assert.ok(q.discard.includes(r1));
    assert.ok(!q.discard.some((c) => c.startsWith('raf:discord:')));
});

test('scenario 8: the Luftwaffe may only escape after neutralising two (D-13)', () => {
    const g = fresh(8);
    const s8 = SCENARIOS.find((x) => x.id === 8);
    const [c, d] = s8.escape[0];
    const a = Object.values(g.aircraft).find((x) => x.seat === 1);
    Object.assign(a, { hex: `${c},${d}`, facing: N });
    // not yet: the edge rule applies instead
    let asked = drive(moveAircraft(g, 1, a, 3, 0, false), ['left']);
    assert.ok(!asked.some((r) => r.options.some((o) => o.id === 'escape')));
    assert.equal(a.status, 'board');
    for (const e of Object.values(g.aircraft).filter((x) => x.seat === 0).slice(0, 2)) e.status = 'neutralised';
    a.facing = N;
    asked = drive(moveAircraft(g, 1, a, 3, 0, false), []);
    assert.equal(a.status, 'escaped');
});
