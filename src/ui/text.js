// Everything the engine says, in words: card and aircraft names, log lines, prompts and option labels. The
// engine only emits keys and data (docs/02 §2.5); every text goes through t().

import { t } from '../i18n/index.js';
import { TYPES, SIDES, baseId } from '../engine/data.js';

export const sideName = (seat) => t(`side.${seat}`);

/** "Y★" for the ace of section Y, "Y1", "B2"… */
export const unitLabel = (typeId) => typeId.replace('ace', '★');

/** Card name from a type key ("raf:commsY" → "Comunicaciones de sección Y"). */
export function cardName(key) {
    const c = TYPES[key];
    if (!c) return key;
    if (c.kind === 'discord') return t('card.discord');
    if (c.id === 'sqn') return t('card.squadron');
    if (c.id.startsWith('comms')) return t('card.section', { s: c.section });
    if (c.id === 'aaa') return t('card.aaa');
    if (c.id === 'ships') return t('card.ships');
    return `${unitLabel(c.id)} ${c.aircraft}`;
}

/**
 * Aircraft id ("luftwaffe:Bace") → "B★ BF 109F"; your own decoy ("…~") says so; a public alias ("…@1", scenario 9)
 * carries the letter of its counter in the pair ("a" / "b"), never which one is the decoy.
 */
export const aircraftName = (id) =>
    cardName(baseId(id)) + (id.includes('@') ? ` ${'ab'[Number(id.split('@')[1]) - 1]}` : '') + (id.endsWith('~') ? ` (${t('card.decoy')})` : '');

export const markerName = (m) => (m ? `${t(`marker.${m.type}`)}${m.defence != null ? ` (${m.defence})` : ''}` : '?');

function targetName(id, view) {
    if (TYPES[baseId(id)]) return aircraftName(id);
    return markerName(view?.markers.find((m) => m.id === id));
}

/** One log entry as a sentence. */
export function logLine(e, view) {
    const p = { ...e };
    if (e.seat != null) p.side = sideName(e.seat);
    if (e.aircraft) p.aircraft = aircraftName(e.aircraft);
    if (e.card) p.card = cardName(e.card);
    if (e.why) p.why = t(`log.why.${e.why}`);
    if (e.from) p.from = t(`log.from.${e.from}`);
    switch (e.k) {
        case 'combat':
            p.type = t(`action.${e.type}`);
            p.by = e.by ? ` (${aircraftName(e.by)})` : '';
            p.target = targetName(e.target, view);
            // dice: null when the companion's player rolled them on the table
            p.dice = e.dice?.length ? e.dice.join(' ') : '—';
            p.result = e.dice && !e.dice.length ? t('log.impossible') : e.success ? t('log.hitResult') : t('log.missResult');
            break;
        case 'destroyed':
            p.marker = markerName(view?.markers.find((m) => m.id === e.marker));
            break;
        case 'bids':
            p.c0 = e.cards[0] ? cardName(e.cards[0]) : '—';
            p.c1 = e.cards[1] ? cardName(e.cards[1]) : '—';
            p.side = sideName(e.initiative);
            p.kept = e.kept ? t('log.kept') : '';
            break;
        case 'leftover': {
            const n = {};
            for (const c of e.cards) n[c] = (n[c] ?? 0) + 1;
            p.cards = Object.entries(n).map(([c, k]) => (k > 1 ? `${cardName(c)} ×${k}` : cardName(c))).join(', ');
            break;
        }
        case 'gameOver':
            p.result = resultText({ winner: e.winner, how: e.how });
            break;
        case 'decoyRemoved':
            return t(`log.decoy.${e.why}`, p);
    }
    return t(`log.${e.k}`, p);
}

export function resultText(r) {
    if (r.how === 'limit') return t('game.limit');
    if (r.winner == null) return t('game.draw');
    return t('game.winner', { side: sideName(r.winner) });
}

/** The question of a pending request. */
export function promptText(req) {
    const p = { ...req };
    if (req.aircraft) p.aircraft = aircraftName(req.aircraft);
    if (req.card) p.card = cardName(req.card);
    return t(`ask.${req.kind}`, p);
}

/** The button text of one option. */
export function optionLabel(req, o, view) {
    const id = o.id;
    if (['end', 'fwd', 'left', 'right', 'stop', 'escape', 'none', 'done', 'draw', 'dark', 'move', 'actFirst', 'moveThenAct'].includes(id)) return t(`opt.${id}`);
    if (id === 'manoeuvre') return t('opt.manoeuvre', { value: o.value, pre: o.pre ? t('opt.pre') : '' });
    if (o.target) {
        return t('opt.target', { type: t(`action.${o.type}`), target: targetName(o.target, view), total: o.total, dice: o.dice, rear: o.rear ? t('opt.rear') : '' });
    }
    if (req.kind === 'comms') {
        const parts = [t(`action.${o.action}`)];
        if (o.value != null) parts.push(o.value);
        if (o.section) parts.push(`[${o.section}]`);
        return parts.join(' ') + (o.discord ? t('opt.discordWarn') : '');
    }
    if (req.kind === 'facing') return t('opt.facing', { facing: o.facing });
    if (req.kind === 'deploy') return o.hex;
    if (o.card) return req.kind === 'bid' ? `${cardName(o.card)} (${o.initiative})` : cardName(o.card);
    if (o.aircraft) return aircraftName(o.aircraft);
    if (o.marker) return markerName(view?.markers.find((m) => m.id === o.marker));
    return id;
}

export { SIDES };
