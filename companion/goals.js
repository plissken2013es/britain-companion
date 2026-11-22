// A scenario's objectives in our own words, from its win conditions (docs/02 §2.3 and §8.6: never the book's text),
// and how far each side is with them, from what the map shows.

import { t } from '../src/i18n/index.js';
import { TYPES, SIDES, baseId } from '../src/engine/data.js';
import { matches, weightOf } from '../src/engine/state.js';

const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${t('cmp.and')} ${xs.at(-1)}`);

/** One condition of a scenario's `win` (docs/02 §2.3) as a sentence. */
function goalText(c) {
    if (c.all) return c.all.map(goalText).join(t('cmp.goal.then'));
    if (c.neutralise != null) {
        const what = c.aircraft ? list(c.aircraft) : c.rank === 'ace' ? t('cmp.goal.aces') : c.rank === 'other' ? t('cmp.goal.others') : t('cmp.goal.aircraft');
        let s = t('cmp.goal.neutralise', { n: c.neutralise, what });
        if (c.weights) s += t('cmp.goal.weights', { what: list(Object.keys(c.weights)), n: Object.values(c.weights)[0] });
        if (c.ace) s += t('cmp.goal.aceWeight', { n: c.ace });
        return s;
    }
    if (c.destroy != null) return t('cmp.goal.destroy', { n: c.destroy, what: list((c.what ?? ['ship', 'structure', 'aaa']).map((m) => t(`cmp.goal.marker.${m}`))) });
    if (c.escape != null) return t(c.what === 'ship' ? 'cmp.goal.escapeShips' : 'cmp.goal.escape', { n: c.escape });
    if (c.points != null) {
        const per = c.per ?? {};
        const parts = [];
        if (per.aircraft) parts.push(t('cmp.goal.perAircraft', { n: per.aircraft }));
        for (const m of ['ship', 'structure', 'aaa']) if (per[m]) parts.push(t('cmp.goal.perMarker', { n: per[m], what: t(`cmp.goal.marker1.${m}`) }));
        for (const [type, n] of Object.entries(per.escaped ?? {})) parts.push(t('cmp.goal.perEscaped', { n, what: type }));
        return t('cmp.goal.points', { n: c.points, per: list(parts) });
    }
    return '';
}

/** A side's objectives: any one of them wins. */
export function goals(sc, seat) {
    return (sc.win[SIDES[seat]] ?? []).map(goalText).join(t('cmp.goal.or'));
}

/** How far a side is with one condition, from what the map shows: "1/2". */
export function progressOf(view, seat, c) {
    if (c.all) return c.all.map((x) => progressOf(view, seat, x)).join(' + ');
    const planes = Object.values(view.aircraft);
    const enemyDown = (cond) => planes.filter((a) => a.seat !== seat && !a.decoy && a.status === 'neutralised' && matches(a, cond)).reduce((n, a) => n + weightOf(cond, a.id), 0);
    if (c.neutralise != null) return `${enemyDown(c)}/${c.neutralise}`;
    if (c.destroy != null) return `${view.markers.filter((m) => m.status === 'destroyed' && (!c.what || c.what.includes(m.type))).length}/${c.destroy}`;
    if (c.escape != null) {
        const n = c.what === 'ship' ? view.markers.filter((m) => m.type === 'ship' && m.status === 'escaped').length
            : planes.filter((a) => a.seat === seat && a.status === 'escaped' && matches(a, c)).length;
        return `${n}/${c.escape}`;
    }
    if (c.points != null) {
        const per = c.per ?? {};
        let n = (per.aircraft ?? 0) * enemyDown({});
        for (const m of view.markers) if (m.status === 'destroyed') n += per[m.type] ?? 0;
        for (const a of planes) if (a.seat === seat && a.status === 'escaped') n += per.escaped?.[TYPES[baseId(a.id)].aircraft] ?? 0;
        return `${n}/${c.points}`;
    }
    return '';
}
