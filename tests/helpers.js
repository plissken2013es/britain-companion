// Shared test helpers.
import { Session } from '../src/engine/session.js';

/** Plays a session to the end with one bot per seat; check(g, prev) runs after every answer. */
export function playOut(session, bots, { check, max = 20000 } = {}) {
    for (let i = 0; !session.over && i < max; i++) {
        const req = session.pending;
        session.act(bots[req.seat](req, session.view(req.seat)));
        if (check) check(session.state);
    }
    return session;
}

/** Cards per player across all zones: never changes during a game. */
export const cardCount = (g) =>
    g.players.map((p) => p.deck.length + p.hand.length + p.discard.length + p.play.length + p.supply.length + p.removed.length + p.aside.length);

/** Answers the pending request with the first option whose id starts with `prefix`. */
export function answer(session, prefix, seat) {
    const req = session.pending;
    if (seat != null && req.seat !== seat) throw new Error(`pending ${req.kind} is for seat ${req.seat}, not ${seat}`);
    const o = req.options.find((x) => x.id === prefix) ?? req.options.find((x) => x.id.startsWith(prefix));
    if (!o) throw new Error(`no option "${prefix}" in ${req.kind}: ${req.options.map((x) => x.id).join(' ')}`);
    session.act(o.id);
    return o;
}

export const newGame = (scenario = 1, seed = 't') => new Session({ scenario, seed });

/**
 * Runs an engine generator, answering its requests in order: an exact option id, the first option starting with
 * it, or a function of the request; with a leading '?', an answer that may not be asked (skipped if it fits no
 * option, e.g. a choice with one option answers itself). Beats are skipped. Returns the requests.
 */
export function drive(gen, answers) {
    const asked = [];
    let r = gen.next();
    while (!r.done) {
        if (r.value.type === 'beat') {
            r = gen.next();
            continue;
        }
        const req = r.value;
        asked.push(req);
        if (!answers.length) throw new Error(`unanswered ${req.kind}: ${req.options.map((o) => o.id).join(' ')}`);
        const find = (x) => (req.options.find((o) => o.id === x) ?? req.options.find((o) => o.id.startsWith(x)))?.id;
        while (typeof answers[0] === 'string' && answers[0].startsWith('?') && !find(answers[0].slice(1))) answers.shift();
        if (!answers.length) throw new Error(`unanswered ${req.kind}: ${req.options.map((o) => o.id).join(' ')}`);
        const a = answers.shift();
        const id = typeof a === 'function' ? a(req) : find(a.startsWith('?') ? a.slice(1) : a);
        if (!id) throw new Error(`no option "${a}" in ${req.kind}: ${req.options.map((o) => o.id).join(' ')}`);
        r = gen.next(id);
    }
    return asked;
}
