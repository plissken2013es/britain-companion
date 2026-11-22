// The round loop (docs/01 §4): draw 4, bid for the initiative, then the initiative player's turn and the other's.

import { choose, log, note, beat } from './ask.js';
import { typeOf } from './data.js';
import { DIRS } from './hex.js';
import { drawCards, gainDiscord, outOfComms, endGame, pub, handPool, bring } from './state.js';
import { playerTurn } from './turn.js';

export { normalizeSetup, createState } from './state.js';

export function* run(g) {
    yield* deploy(g);
    for (;;) {
        g.round++;
        if (g.round > g.setup.maxRounds) endGame(g, null, 'limit'); // safety net for bots, not a rule
        log(g, 'round', { round: g.round });
        g.phase = 'draw';
        for (const seat of [0, 1]) drawCards(g, seat, 4);
        g.phase = 'bid';
        yield* bid(g);
        g.phase = 'turns';
        const first = g.initiative;
        yield* playerTurn(g, first);
        yield* playerTurn(g, 1 - first);
        g.turn = null;
    }
}

/**
 * Scenario 9: the owner places each aircraft on a free deploy hex, facing where they like. The real aircraft are
 * placed before their decoys, so the rival sees none of it until all are down (view.js) and the log lists them by
 * public id: in placing order, the first of each pair would be the real one.
 */
function* deploy(g) {
    const placed = [];
    for (const a of Object.values(g.aircraft)) {
        if (a.status !== 'deploy') continue;
        const free = g.deploy.filter((k) => !Object.values(g.aircraft).some((x) => x.hex === k));
        const hex = yield* choose(g, a.seat, 'deploy', free.map((k) => ({ id: `hex:${k}`, hex: k })), { aircraft: a.id });
        a.hex = hex.slice(4);
        const facing = yield* choose(g, a.seat, 'facing', DIRS.map((d, i) => ({ id: `f:${i}`, facing: d })), { aircraft: a.id });
        a.facing = Number(facing.slice(2));
        a.status = 'board';
        placed.push(a);
    }
    const order = (a) => pub(g, a.id);
    // with where each one is, for the companion's player to set the counters out on the table
    for (const a of placed.sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0))) log(g, 'deployed', { seat: a.seat, aircraft: a.id, hex: a.hex, facing: a.facing });
}

/** Both choose a card in secret; the higher initiative takes the marker, a tie keeps it where it is. */
function* bid(g) {
    for (const seat of [0, 1]) {
        const p = g.players[seat];
        if (!p.hand.length) continue;
        // an external seat may bid any card of its hand and deck (docs/02 §8.4)
        const types = [...new Map(handPool(g, seat).map((c) => [typeOf(c).id, c])).values()];
        const answer = yield* choose(g, seat, 'bid', types.map((c) => ({ id: `bid:${typeOf(c).id}`, card: typeOf(c).key, initiative: typeOf(c).initiative })));
        p.bid = bring(g, seat, (c) => typeOf(c).id === answer.slice(4));
        note(g, seat, 'bid', { cid: p.bid });
    }
    const [a, b] = g.players.map((p) => (p.bid ? typeOf(p.bid).initiative : 0));
    const before = g.initiative;
    if (a !== b) g.initiative = a > b ? 0 : 1;
    log(g, 'bids', { cards: g.players.map((p) => p.bid && typeOf(p.bid).key), initiative: g.initiative, kept: a === b });
    yield* beat(g, 'bids', { initiative: g.initiative, changed: before !== g.initiative });
    g.players.forEach((p, seat) => {
        if (!p.bid) return;
        const t = typeOf(p.bid);
        p.hand.splice(p.hand.indexOf(p.bid), 1);
        p.discard.push(p.bid);
        p.bid = null;
        if (t.initiativeIcon === 'discord' && outOfComms(g, seat, t.section)) gainDiscord(g, seat, 'bid');
    });
}
