// What one seat may see ([D-11]): its own hand, deck order hidden, the opponent's hand and deck only as counts,
// bids hidden until revealed. Bots and the UI only ever get this.

import { typeOf } from './data.js';
import { isExternal } from './state.js';

/** The opponent's paired counters (scenario 9) appear under their public alias, without the decoy flag. */
function aircraftFor(g, seat) {
    const out = {};
    for (const a of Object.values(g.aircraft)) {
        const v = structuredClone(a);
        if (a.seat !== seat && g.alias?.[a.id]) {
            v.id = g.alias[a.id];
            if (a.status !== 'removed') {
                delete v.decoy;
                delete v.of;
            }
        } else if (g.alias?.[a.id]) v.pub = g.alias[a.id]; // your own counter's public name, the one the log uses
        // scenario 9: while the owner deploys, the rival sees no counter on the board (in placing order, the first of
        // each pair would be the real one)
        if (a.seat !== seat && g.phase === 'setup' && (a.status === 'deploy' || (a.status === 'board' && g.deploy?.includes(a.hex)))) {
            v.status = 'deploy';
            delete v.hex;
            delete v.facing;
        }
        out[v.id] = v;
    }
    // decoys are created after their aircraft: in that order the first counter of each pair would be the real one, so
    // with decoys in play the counters go by their public id
    if (!g.alias) return out;
    return Object.fromEntries(Object.entries(out).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}

/** Cards per type ({ 'raf:Y1': 2, … }). */
function countTypes(cards) {
    const out = {};
    for (const c of cards) out[typeOf(c).key] = (out[typeOf(c).key] ?? 0) + 1;
    return out;
}

export function view(g, seat) {
    const players = g.players.map((p, s) => ({
        side: p.side,
        // an external seat (the companion's player, docs/02 §8.4): the engine does not know its hand, only which
        // cards are in its hand and deck together (public: everything else is on the table)
        external: isExternal(g, s),
        hidden: isExternal(g, s) ? countTypes([...p.hand, ...p.deck]) : null,
        hand: s === seat && !isExternal(g, s) ? [...p.hand] : null,
        handCount: p.hand.length,
        deckCount: p.deck.length,
        discard: [...p.discard],
        play: [...p.play],
        supply: [...p.supply],
        removedCount: p.removed.length,
        removed: s === seat ? [...p.removed] : null,
        aside: p.aside.length,
        bidding: p.bid != null,
        bid: s === seat && !isExternal(g, s) ? p.bid : null,
    }));
    return {
        seat,
        scenario: g.scenario,
        external: g.setup.external ?? null,
        botDice: g.setup.botDice ?? null,
        round: g.round,
        turn: g.turn,
        phase: g.phase,
        initiative: g.initiative,
        players,
        aircraft: aircraftFor(g, seat),
        markers: structuredClone(g.markers),
        deploy: [...g.deploy],
        log: g.log,
        notes: g.notes[seat],
        result: g.result,
    };
}
