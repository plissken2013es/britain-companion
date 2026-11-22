// The companion's game screen (docs/02 §8.3): the map, and beside it one thing at a time: a step for the table ("fly
// the German B★: forward, forward, turn right") with "Done", or the player's decision with big buttons (the card they
// play and how, each step of a flight, the target, hit or miss, where a hit's card comes from). The computer plays
// its side through view(g, seat) only; the player's seat is external (setup.external, docs/02 §8.4), so the app never
// sees their hand: it offers only what they may hold. Undo goes back to before the player's last answer; the game is
// saved after each one. On a phone the map zooms and pans (src/ui/zoom.js) and a long press tells what is on a hex.
// Ported from 61's companion/play.js.

import { h } from '../src/ui/dom.js';
import { t, scenarioTitle } from '../src/i18n/index.js';
import { Session, makeRecord, encodeRecord } from '../src/engine/session.js';
import { createState, withoutRoundLimit } from '../src/engine/state.js';
import { view as viewOf } from '../src/engine/view.js';
import { scenarioById, TYPES, SIDES, baseId } from '../src/engine/data.js';
import { step as stepHex, tileHexes } from '../src/engine/hex.js';
import { hitChance } from '../src/engine/combat.js';
import { computerBot } from '../src/ai/computerBot.js';
import { cardName, logLine, markerName, optionLabel, resultText, sideName } from '../src/ui/text.js';
import { sfx, loadSamples, setMuted } from '../src/ui/sound.js';
import { BoardZoom } from '../src/ui/zoom.js';
import { canFullscreen, isFullscreen, toggleFullscreen } from '../src/ui/touch.js';
import { drawMap, hexAtPoint } from './map.js';
import { boardAt, guideSteps } from './guide.js';
import { planeName, dirName, cardList } from './names.js';
import { goals, progressOf } from './goals.js';
import { CONTACT, bugMail, appKind } from './contact.js';

export { goals };

export const SAVE = 'ubc-save';
export const PREFS = 'ubc-prefs';

export function loadSaved() {
    try {
        const g = JSON.parse(localStorage.getItem(SAVE));
        return g?.setup && Array.isArray(g.answers) ? g : null;
    } catch {
        return null;
    }
}

/** A preference of the companion (shared with the start screen). */
export function pref(key) {
    try {
        return JSON.parse(localStorage.getItem(PREFS))?.[key];
    } catch {
        return undefined;
    }
}

export function setPref(key, value) {
    try {
        localStorage.setItem(PREFS, JSON.stringify({ ...JSON.parse(localStorage.getItem(PREFS) ?? '{}'), [key]: value }));
    } catch {}
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let tray = null;
/** The 3D dice (src/ui/dice3d.js), loaded the first time; null without WebGL. */
export function warmDice() {
    return (tray ??= import('../src/ui/dice3d.js').then((m) => m.createDiceTray()).catch(() => null));
}

// ------------------------------------------------------------------ the game screen

export class CompanionView {
    /** @param {HTMLElement} root @param {{ setup: any, answers?: string[], marks?: number[] }} game */
    constructor(root, game, { onExit } = {}) {
        this.root = root;
        this.onExit = onExit;
        this.session = new Session(withoutRoundLimit(game.setup), game.answers ?? []);
        this.me = this.session.setup.external;
        this.botSeat = 1 - this.me;
        this.sc = scenarioById(this.session.setup.scenario);
        this.bot = computerBot(this.sc.id, this.botSeat, `${this.session.setup.seed}:bot`);
        this.marks = game.marks ?? []; // answers.length before each of the player's answers (undo)
        this.panelOpen = { mine: true }; // the panels' <details> are rebuilt every render; this keeps them open or closed
        // the steps still to show: those of the log since `base.logStart`, less the `done` ones; saved with the game, so
        // a game left halfway through the computer's turn comes back to the same step
        this.steps = [];
        this.base = game.base ?? null;
        this.done = game.done ?? 0;
        this.busy = false;
        this.modal = h('div', { class: 'modal', hidden: true, onclick: (e) => { if (e.target === this.modal) this.hideModal(); } });
        this.top = h('header', { class: 'bar' });
        // the map's frame outlives every render: the zoom stays while the map is redrawn
        this.zoom = new BoardZoom({ onInfo: (x, y) => this.showHex(x, y), tapAgain: () => t('cmp.tapAgain'), resetLabel: t('cmp.mapReset') });
        this.panel = h('aside', { class: 'panel' });
        this.root.replaceChildren(h('div', { class: 'cplay' }, this.top, h('main', {}, this.zoom.el, this.panel), this.modal));
        // the recordings allowed in the public companion (docs/02 §8.6: CC0, and CC BY with the credit)
        setMuted(pref('sound') === false);
        loadSamples();
        this.onFullscreen = () => { if (!this.disposed) this.renderTop(this.shown ?? this.view()); };
        for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, this.onFullscreen);
        this.onKeydown = (e) => { if (e.key === 'Escape' && !this.modal.hidden) this.hideModal(); };
        document.addEventListener('keydown', this.onKeydown);
        // a new game starts with the steps of its first round (draw your cards), from the table as set up, before any of
        // the log (the cards rebuilt from it would otherwise count it twice); a saved one at the step it was left on
        if (this.base) this.refreshSteps();
        else if (!game.answers?.length) this.addSteps(0, viewOf(createState(this.session.setup), this.me));
        this.runBot(this.session.state.log.length, null);
    }

    dispose() {
        this.disposed = true;
        for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(ev, this.onFullscreen);
        document.removeEventListener('keydown', this.onKeydown);
    }

    view() {
        return this.session.view(this.me);
    }

    save() {
        try {
            const steps = this.steps.length ? { base: this.base, done: this.done } : {};
            localStorage.setItem(SAVE, JSON.stringify({ setup: this.session.setup, answers: this.session.answers, marks: this.marks, ...steps }));
        } catch {}
    }

    /** The player's answer: then the computer plays until the player's next decision; their steps go first. */
    act(answer) {
        if (this.busy || this.disposed) return;
        const before = structuredClone({ ...this.view(), log: [] });
        const logStart = this.session.state.log.length;
        this.marks.push(this.session.answers.length);
        this.session.act(answer);
        this.runBot(logStart, before);
    }

    async runBot(logStart, before) {
        // the computer's turn, before any of its steps is shown: the table catches up step by step after, and while
        // it thinks the map and the panels stay as they were (61 §7.9, PR #2)
        const start = before ?? structuredClone({ ...this.view(), log: [] });
        this.busy = boardAt(start, [], -1);
        this.render();
        while (!this.session.over && this.session.pending?.seat === this.botSeat) {
            await tick(30); // let the page show that the computer is thinking
            if (this.disposed) return;
            const req = this.session.pending;
            this.session.act(this.bot(req, this.session.view(this.botSeat)));
        }
        this.busy = false;
        this.addSteps(logStart, start);
        this.save();
        this.render();
    }

    /** The steps of the log since `logStart` join those still to show (a new base if there are none). */
    addSteps(logStart, before) {
        if (!this.steps.length) {
            this.base = { logStart, before };
            this.done = 0;
        }
        this.refreshSteps();
    }

    refreshSteps() {
        const { logStart, before } = this.base;
        this.steps = this.stepsOf(this.session.state.log.slice(logStart), before, logStart).slice(this.done);
    }

    /** The player is done with `n` steps. */
    stepsDone(n = 1) {
        this.steps.splice(0, n);
        this.done += n;
        this.save();
        this.render();
    }

    /**
     * The steps of these log entries, each with the board and the Log panel as they stand after it, so neither gets
     * ahead of the "Done" cards the player is clicking through (61 §7.9, PR #2).
     */
    stepsOf(entries, before, logStart) {
        const prior = this.session.state.log.slice(0, logStart);
        return guideSteps(entries, this.me, before)
            .map((step) => ({ ...step, board: boardAt(before, entries, step.at), log: prior.concat(entries.slice(0, step.at + 1)) }));
    }

    undo() {
        if (this.busy || !this.marks.length) return;
        this.session.rewindTo(this.marks.pop());
        this.steps = [];
        this.base = null;
        this.save();
        this.render();
    }

    exit() {
        this.dispose();
        this.onExit?.();
    }

    // ------------------------------------------------------------------ drawing

    render() {
        if (this.disposed) return;
        const view = this.view();
        const step = this.steps[0];
        const req = !step && !this.busy && !this.session.over ? this.session.pending : null;
        this.shown = step?.board ?? (this.busy || boardAt(view, [], -1));
        this.renderTop(this.shown);
        const picks = new Map();
        let arrow = [], focus = {};
        if (step) {
            focus = step.focus ?? {};
            arrow = step.arrow ?? [];
        } else if (req) {
            this.picksFor(req, picks);
            if (req.kind === 'roll') {
                focus = { aircraft: req.target };
                if (req.by) arrow = [{ from: req.by, to: req.target, side: SIDES[req.attacker] }];
            }
            if (req.aircraft) focus = { aircraft: req.aircraft };
        }
        this.zoom.show(drawMap(this.shown, { picks, onPick: (id) => this.act(id), me: this.me, focus, arrow, terrain: pref('terrain') !== false, planes: pref('planes') === true }));
        const main = step ? this.stepCard(step) : this.busy ? h('div', { class: 'card-box thinking' }, t('cmp.thinking'))
            : this.session.over ? this.endCard() : req ? this.askCard(req, view) : null;
        this.panel.replaceChildren(main ?? '',
            this.openPanel('goals', this.goalsPanel(this.shown)),
            this.openPanel('mine', this.minePanel(this.shown)),
            this.openPanel('bot', this.botPanel(this.shown)),
            this.openPanel('log', this.logPanel(step ? step.log : view.log, this.shown)));
    }

    /** `el` (a fresh <details>, rebuilt every render) opens as `key` was last left, and keeps that as the player toggles it. */
    openPanel(key, el) {
        el.open = this.panelOpen[key] ?? false;
        el.addEventListener('toggle', () => { this.panelOpen[key] = el.open; });
        return el;
    }

    renderTop(view) {
        const ini = t('cmp.initiative', { side: view.initiative === this.me ? t('cmp.you') : t('cmp.bot') });
        this.top.replaceChildren(
            h('strong', {}, `${this.sc.id}. ${scenarioTitle(this.sc)}`),
            h('span', { class: 'muted' }, t('cmp.round', { n: Math.max(1, view.round) })),
            h('span', { class: `ini ${SIDES[view.initiative]}` }, ini),
            h('span', { class: 'grow' }),
            h('button', { class: 'extras', onclick: () => this.showCheck() }, t('cmp.menu.check')),
            h('button', { onclick: () => this.undo(), disabled: Boolean(this.busy) || !this.marks.length }, `↶ ${t('cmp.menu.undo')}`),
            h('button', { class: 'menu-btn', title: t('cmp.menu'), onclick: () => this.showMenu() }, '☰'));
    }

    menuItems() {
        return [
            [t('cmp.menu.check'), () => this.showCheck()],
            [t(pref('sound') === false ? 'cmp.menu.soundOff' : 'cmp.menu.soundOn'), () => {
                setPref('sound', pref('sound') === false);
                setMuted(pref('sound') === false);
                this.showMenu();
            }],
            [t(pref('terrain') === false ? 'cmp.menu.mapDiagram' : 'cmp.menu.mapTerrain'), () => {
                setPref('terrain', pref('terrain') === false);
                this.render();
                this.showMenu();
            }],
            [t(pref('planes') === true ? 'cmp.menu.planesOn' : 'cmp.menu.planesOff'), () => {
                setPref('planes', pref('planes') !== true);
                this.render();
                this.showMenu();
            }],
            [t(pref('dice3d') === false ? 'cmp.menu.dice3dOff' : 'cmp.menu.dice3dOn'), () => {
                setPref('dice3d', pref('dice3d') === false);
                this.showMenu();
            }],
            canFullscreen() ? [t(isFullscreen() ? 'cmp.menu.exitFullscreen' : 'cmp.menu.fullscreen'), () => {
                this.hideModal();
                toggleFullscreen();
            }] : null,
            [t('cmp.menu.code'), () => this.copyCode()],
            CONTACT ? [t('cmp.bug'), () => this.reportBug()] : null,
            [t('cmp.menu.exit'), () => this.exit()],
        ].filter(Boolean);
    }

    showMenu() {
        this.showModal(h('div', { class: 'opts' }, this.menuItems().map(([label, fn]) => h('button', { class: 'opt', onclick: fn }, label)),
            h('button', { class: 'opt quiet', onclick: () => this.hideModal() }, t('cmp.close'))));
    }

    /** One step for the table; an attack by the computer rolls its dice first. */
    stepCard(step) {
        const n = this.steps.length;
        const done = () => this.stepsDone();
        const marked = (text) => {
            const i = step.played ? text.indexOf(step.played) : -1;
            if (i < 0) return text;
            return [text.slice(0, i), h('strong', { class: `played ${step.side}` }, step.played), text.slice(i + step.played.length)];
        };
        if (!step.sounded) {
            step.sounded = true;
            playSound(step.sound, step.side);
        }
        const box = h('div', { class: `card-box step ${step.kind} ${step.side}` },
            step.head ? h('div', { class: 'head' }, marked(step.head)) : null,
            h('p', { class: 'big' }, marked(step.text)),
            step.lines?.length ? h('ul', {}, step.lines.map((l) => h('li', {}, l))) : null);
        const result = h('p', { class: `result ${step.hit ? 'hit' : 'miss'}` });
        const buttons = h('div', { class: 'buttons' },
            h('button', { class: 'primary', onclick: done }, t('cmp.done')),
            n > 1 ? h('button', { onclick: () => this.stepsDone(n) }, t('cmp.doneAll', { n })) : null);
        if (step.after) {
            box.append(result);
            if (step.dice && !step.rolled) {
                // no button while the dice roll (61 §7.9, PR #1); the computer's attack first shows its odds
                buttons.hidden = true;
                const go = () => this.rollDice(step).then(() => {
                    step.rolled = true;
                    result.textContent = step.after;
                    buttons.hidden = false;
                });
                const pct = Math.round(100 * hitChance(step.total, step.dice.length));
                const ready = h('p', { class: 'small muted' }, `${t('cmp.roll.need', { total: step.total })} (${pct} %)`);
                const rollBtn = h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => { ready.remove(); rollBtn.remove(); go(); } }, t('cmp.roll.go')));
                box.append(ready, rollBtn);
            } else result.textContent = step.after;
        }
        box.append(buttons);
        return box;
    }

    async rollDice(step) {
        fireSound(step.fire, step.seat);
        await tick(350);
        sfx.dice();
        const dice = pref('dice3d') === false ? null : await warmDice();
        if (dice) {
            const roll = dice.roll(step.dice.map((v) => ({ sides: 10, value: v % 10, color: step.side })), { rect: this.zoom.el.getBoundingClientRect() });
            if (await Promise.race([roll.then(() => false), tick(6000).then(() => true)])) dice.skip();
        } else await tick(400);
        if (step.hit) sfx.thud();
        else sfx.miss(step.dice.length);
    }

    endCard() {
        const r = this.session.state.result;
        const title = r.winner == null ? t('cmp.end.draw') : r.winner === this.me ? t('cmp.end.won') : t('cmp.end.lost');
        return h('div', { class: 'card-box end' }, h('h2', {}, title), h('p', {}, resultText(r)),
            h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => { try { localStorage.removeItem(SAVE); } catch {} this.exit(); } }, t('cmp.end.again'))));
    }

    /** What the map answers: hexes, aircraft and markers named by the options. */
    picksFor(req, picks) {
        const view = this.view();
        for (const o of req.options) {
            if (o.hex && req.kind === 'deploy') picks.set(`hex:${o.hex}`, o.id);
            else if (o.target) picks.set(o.target, o.id);
            else if (o.aircraft) picks.set(o.aircraft, o.id);
            else if (o.marker) picks.set(o.marker, o.id);
        }
        // a flight: the hex ahead moves there
        if (req.kind === 'move' && req.options.some((o) => o.id === 'fwd')) {
            const a = view.aircraft[req.aircraft];
            if (a) picks.set(`hex:${stepHex(a.hex, a.facing)}`, 'fwd');
        }
        // playing a card: the player's aircraft whose card they may hold
        if (req.kind === 'play') {
            for (const o of req.options) {
                if (!o.card || TYPES[o.card].kind !== 'combat') continue;
                const a = view.aircraft[o.card];
                if (a?.status === 'board') picks.set(a.id, o.id);
            }
        }
    }

    /** The player's decision. */
    askCard(req, view) {
        const pn = (id) => planeName(id, view, this.me);
        const btn = (o, label, cls = '') => h('button', { class: `opt ${cls}`, onclick: () => this.act(o.id) }, label);
        const box = (title, ...rest) => h('div', { class: `card-box ask ${req.kind}` }, h('h3', {}, title), ...rest);
        const onMap = h('p', { class: 'small muted' }, t('cmp.pickOnMap'));
        const plain = (o) => optionLabel(req, o, view);
        switch (req.kind) {
            case 'bid': {
                const opts = [...req.options].sort((a, b) => b.initiative - a.initiative);
                return box(t('cmp.ask.bid'), h('p', {}, t('cmp.ask.bidText')),
                    h('div', { class: 'opts grid' }, opts.map((o) => btn(o, `${cardName(o.card)} (${o.initiative})`))));
            }
            case 'play': {
                const end = req.options.find((o) => o.id === 'end');
                const cards = req.options.filter((o) => o.card);
                return box(t('cmp.ask.play'), h('p', { class: 'small muted' }, t('cmp.ask.playHand', { n: view.players[this.me].handCount })),
                    h('div', { class: 'opts grid' }, cards.map((o) => btn(o, cardName(o.card)))),
                    end ? h('div', { class: 'buttons' }, btn(end, t('cmp.ask.end'), 'quiet')) : null);
            }
            case 'plan':
                return box(t('cmp.ask.plan', { card: cardName(req.card) }), h('div', { class: 'opts' }, req.options.map((o) => btn(o, plain(o)))));
            case 'move': {
                const a = view.aircraft[req.aircraft];
                const sub = t('cmp.ask.moveSub', { moved: req.moved, max: req.max, turns: req.turns, facing: dirName(a.facing) });
                const order = ['fwd', 'escape', 'left', 'right', 'stop'];
                const opts = [...req.options].sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
                return box(t('cmp.ask.move', { aircraft: pn(req.aircraft) }), h('p', { class: 'small muted' }, sub),
                    h('div', { class: 'opts grid' }, opts.map((o) => btn(o, plain(o), o.id === 'stop' ? 'quiet' : ''))));
            }
            case 'edge':
                return box(t('cmp.ask.edge', { aircraft: pn(req.aircraft) }), h('p', { class: 'small' }, t('cmp.ask.edgeText')),
                    h('div', { class: 'opts two' }, req.options.map((o) => btn(o, plain(o)))));
            case 'combat':
                return box(t('cmp.ask.combat'), onMap, h('div', { class: 'opts' }, req.options.map((o) => btn(o, o.id === 'none' ? t('opt.none') : this.targetLabel(o, view), o.id === 'none' ? 'quiet' : ''))));
            case 'comms':
                return box(t('cmp.ask.comms', { card: cardName(req.card) }),
                    h('div', { class: 'opts' }, req.options.map((o) => btn(o, plain(o), o.id === 'dark' ? 'quiet' : '')),
                        (req.blocked ?? []).map((b) => h('button', { class: 'opt', disabled: true }, `${t(`action.${b.action}`)}${b.value != null ? ` ${b.value}` : ''} — ${t(`cmp.blocked.${b.reason}`)}`))));
            case 'bolster':
                return box(t('cmp.ask.bolster', { left: req.left }), h('div', { class: 'opts' }, req.options.map((o) => btn(o, o.id === 'done' ? t('opt.done') : cardName(o.card), o.id === 'done' ? 'quiet' : ''))));
            case 'command':
                return box(t('cmp.ask.command', { left: req.left }), h('div', { class: 'opts two' }, req.options.map((o) => btn(o, plain(o), o.id === 'done' ? 'quiet' : ''))));
            case 'guide':
                return box(t('cmp.ask.guide'), onMap, h('div', { class: 'opts' }, req.options.map((o) => btn(o, pn(o.aircraft)))));
            case 'guideTurn':
                return box(t('cmp.ask.guideTurn', { aircraft: pn(req.aircraft) }), h('div', { class: 'opts' }, req.options.map((o) => btn(o, o.id === 'none' ? t('cmp.ask.noTurn') : plain(o)))));
            case 'inspire':
                return box(t('cmp.ask.inspire'), h('div', { class: 'opts' }, req.options.map((o) => btn(o, cardName(o.card)))));
            case 'sail':
                return box(t('cmp.ask.sail'), onMap, h('div', { class: 'opts' }, req.options.map((o) => btn(o, o.id === 'done' ? t('opt.done') : `${t('marker.ship')} (${o.marker})`, o.id === 'done' ? 'quiet' : ''))));
            case 'deploy':
                return box(t('cmp.ask.deploy', { aircraft: pn(req.aircraft) }), onMap);
            case 'facing':
                return box(t('cmp.ask.facing', { aircraft: pn(req.aircraft) }), h('div', { class: 'opts grid' }, req.options.map((o) => btn(o, dirName(Number(o.id.slice(2)))))));
            case 'leftover':
                return box(t('cmp.ask.leftover', { left: req.left }), h('p', { class: 'small muted' }, t('cmp.ask.leftoverText')),
                    h('div', { class: 'opts grid' }, req.options.map((o) => btn(o, cardName(o.card)))));
            case 'casualty':
                return box(t('cmp.ask.casualty', { aircraft: pn(req.aircraft) }), h('p', { class: 'small' }, t('cmp.ask.casualtyRule')),
                    h('div', { class: 'opts' }, req.options.map((o) => btn(o, t(`cmp.ask.from.${o.from}`)))));
            case 'purge':
                return box(t('cmp.ask.purge', { aircraft: pn(req.aircraft), n: req.cards }), h('p', { class: 'small' }, t('cmp.ask.purgeText')),
                    h('div', { class: 'opts grid' }, req.options.map((o) => btn(o, String(o.n)))));
            case 'roll':
                return this.rollCard(req, btn, view);
            default:
                return box(req.kind, h('div', { class: 'opts' }, req.options.map((o) => btn(o, plain(o)))));
        }
    }

    targetLabel(o, view) {
        const target = TYPES[baseId(o.target)] ? planeName(o.target, view, this.me) : markerName(view.markers.find((m) => m.id === o.target));
        const pct = Math.round(100 * hitChance(o.total, o.dice));
        return t('cmp.ask.target', { type: t(`action.${o.type}`), target, total: o.total, dice: o.dice, pct, rear: o.rear ? t('opt.rear') : '' });
    }

    rollCard(req, btn, view) {
        const pn = (id) => planeName(id, view, this.me);
        const mine = req.attacker === this.me;
        const target = TYPES[baseId(req.target)] ? pn(req.target) : markerName(view.markers.find((m) => m.id === req.target));
        const parts = [t('cmp.roll.defence', { n: req.defence })];
        if (req.cover) parts.push(t('cmp.roll.cover', { n: req.cover }));
        if (req.range) parts.push(t('cmp.roll.range', { n: req.range }));
        return h('div', { class: `card-box ask roll ${SIDES[req.attacker]}` },
            h('h3', {}, t(mine ? 'cmp.roll.title' : 'cmp.roll.botTitle', { n: req.dice })),
            h('p', {}, `${t(`action.${req.type}`)}: ${req.by ? `${pn(req.by)} → ` : ''}${target}${req.rear ? t('opt.rear') : ''}`),
            h('p', { class: 'need' }, `${req.total}+`),
            h('p', { class: 'big' }, t('cmp.roll.need', { total: req.total })),
            h('p', { class: 'small muted' }, `${parts.join(' + ')} · ${Math.round(100 * hitChance(req.total, req.dice))} %`),
            h('div', { class: 'opts two' }, req.options.map((o) => h('button', { class: `opt ${o.id}`, onclick: () => {
                fireSound(req.type, req.attacker);
                this.act(o.id);
            } }, t(`cmp.roll.${o.id}`)))));
    }

    // ------------------------------------------------------------------ panels

    goalsPanel(view) {
        return h('details', { class: 'info' }, h('summary', {}, t('cmp.goal.title')),
            h('ul', {}, [0, 1].map((seat) => h('li', {}, h('b', {}, `${sideName(seat)}${seat === this.me ? ` (${t('cmp.you')})` : ''}: `), goals(this.sc, seat),
                h('span', { class: 'progress' }, ` · ${(this.sc.win[SIDES[seat]] ?? []).map((c) => progressOf(view, seat, c)).join(t('cmp.goal.or'))}`)))));
    }

    minePanel(view) {
        const p = view.players[this.me];
        const pile = (label, cards) => h('p', {}, h('b', {}, `${label}: `), Object.keys(cards ?? {}).length ? countList(cards) : t('cmp.none'));
        return h('details', { class: 'info' }, h('summary', {}, t('cmp.cards.mine', { hand: p.handCount, deck: p.deckCount })),
            pile(t('cmp.cards.handDeck'), p.hidden),
            pile(t('cmp.cards.discard'), p.discard),
            pile(t('cmp.cards.play'), p.play),
            pile(t('cmp.cards.supply'), p.supply),
            h('p', { class: 'small muted' }, t('cmp.cards.out', { removed: p.removedCount, aside: p.aside })));
    }

    botPanel(view) {
        const p = view.players[this.botSeat];
        const pile = (label, cards) => h('p', {}, h('b', {}, `${label}: `), Object.keys(cards ?? {}).length ? countList(cards) : t('cmp.none'));
        return h('details', { class: 'info' }, h('summary', {}, t('cmp.cards.bot', { hand: p.handCount, deck: p.deckCount })),
            pile(t('cmp.cards.discard'), p.discard),
            pile(t('cmp.cards.play'), p.play),
            pile(t('cmp.cards.supply'), p.supply),
            h('p', { class: 'small muted' }, t('cmp.cards.out', { removed: p.removedCount, aside: p.aside })));
    }

    logPanel(entries, view) {
        const lines = entries.slice(-60).map((e) => h('li', { class: e.k === 'round' ? 'round' : '' }, logLine(e, view)));
        return h('details', { class: 'info log' }, h('summary', {}, t('cmp.menu.log')), h('ol', { reversed: true }, lines.reverse()));
    }

    // ------------------------------------------------------------------ the check and the code

    /** Where a hex is on the table: the land tile it belongs to, or the sea. */
    placeOf(hex) {
        const tile = this.sc.tiles.find((x) => tileHexes(x).includes(hex));
        return tile ? t('cmp.check.tile', { tile: tile.id }) : t('cmp.check.sea');
    }

    /** A long press on the map: what is on that hex. */
    showHex(x, y) {
        const view = this.shown;
        const hex = hexAtPoint(view, x, y);
        if (!hex) return;
        const planes = Object.values(view.aircraft).filter((a) => a.status === 'board' && a.hex === hex)
            .map((a) => `${planeName(a.pub ?? a.id, view, this.me)} (${dirName(a.facing)}${a.ready ? '' : `, ${t('cmp.check.out')}`})`);
        const marks = view.markers.filter((m) => m.status === 'board' && m.hex === hex).map((m) => markerName(m));
        this.showModal(h('div', { class: 'check' },
            h('h3', {}, this.placeOf(hex)),
            h('p', {}, h('b', {}, `${t('cmp.check.aircraft')}: `), planes.join(', ') || t('cmp.none')),
            h('p', {}, h('b', {}, `${t('cmp.check.markers')}: `), marks.join(', ') || t('cmp.none')),
            h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => this.hideModal() }, t('cmp.close')))));
    }

    /** Every counter as the app has it, to compare with the table (docs/02 §8.3, point 5). */
    showCheck() {
        const view = this.shown ?? this.view();
        const rows = Object.values(view.aircraft).filter((a) => a.status === 'board').map((a) => h('tr', {},
            h('td', {}, h('b', {}, planeName(a.pub ?? a.id, view, this.me))),
            h('td', {}, this.placeOf(a.hex)),
            h('td', {}, dirName(a.facing)),
            h('td', {}, a.ready ? t('cmp.check.ready') : t('cmp.check.out'))));
        const off = Object.values(view.aircraft).filter((a) => a.status !== 'board' && a.status !== 'deploy' && !(a.decoy && a.seat === this.me))
            .map((a) => `${planeName(a.pub ?? a.id, view, this.me)} (${t(`cmp.check.status.${a.status}`)})`);
        this.showModal(h('div', { class: 'check' },
            h('h3', {}, t('cmp.check.title')),
            h('p', { class: 'small' }, t('cmp.check.intro')),
            h('table', {}, h('thead', {}, h('tr', {}, ['aircraft', 'where', 'facing', 'state'].map((k) => h('th', {}, t(`cmp.check.${k}`))))), h('tbody', {}, rows)),
            off.length ? h('p', { class: 'small' }, h('b', {}, `${t('cmp.check.offBoard')}: `), off.join(', ')) : null,
            this.minePanel(view), this.botPanel(view),
            h('div', { class: 'buttons' }, h('button', { class: 'primary', onclick: () => this.hideModal() }, t('cmp.close')))));
        for (const d of this.modal.querySelectorAll('details')) d.open = true;
    }

    async copyCode() {
        const code = await encodeRecord(makeRecord(this.session, 'companion'));
        try {
            await navigator.clipboard.writeText(code);
            this.hideModal();
            this.toast(t('cmp.menu.codeCopied'));
        } catch {
            this.showModal(h('div', {}, h('textarea', { rows: 6, cols: 40, readonly: true }, code),
                h('div', { class: 'buttons' }, h('button', { onclick: () => this.hideModal() }, t('cmp.close')))));
        }
    }

    /** An email to report a bug, with the game's code: in the body, or by the clipboard when it is too long. */
    async reportBug() {
        const code = await encodeRecord(makeRecord(this.session, 'companion'));
        const mail = bugMail(CONTACT, { code, app: appKind(), agent: navigator.userAgent });
        if (mail.clipboard) {
            try {
                await navigator.clipboard.writeText(code);
                this.toast(t('cmp.bug.copied'));
            } catch {}
        }
        h('a', { href: mail.url }).click();
    }

    toast(text) {
        const el = h('div', { class: 'toast' }, text);
        document.body.append(el);
        setTimeout(() => el.remove(), 2200);
    }

    showModal(content) {
        this.modal.replaceChildren(h('div', { class: 'modal-box' }, content));
        this.modal.hidden = false;
        // a step of the page's history, so that Back closes it and does not leave the game
        if (!history.state?.modal) history.pushState({ game: true, modal: true }, '');
    }

    hideModal() {
        if (history.state?.modal) history.back(); // popstate closes it
        else this.closeModal();
    }

    closeModal() {
        this.modal.hidden = true;
        this.modal.replaceChildren();
    }
}

/** The sound of a step for the table (guide.js `sound`), for the side it is about. */
function playSound(name, side) {
    const seat = side === 'luftwaffe' ? 1 : 0;
    if (name === 'engine') sfx.engine(0, seat);
    else if (name === 'boom') sfx.boom(0, true);
    else if (name && sfx[name]) sfx[name]();
}

/** The sound of a combat action: machine guns, flak or a falling bomb. */
function fireSound(type, seat) {
    if (type === 'antiAir') sfx.flak();
    else if (type === 'bomb') sfx.whistle();
    else sfx.guns(0, seat);
}

/** "Y1 Hurricane ×2, Discordia" from a { key: n } count. */
function countList(cards) {
    return cardList(Object.entries(cards).flatMap(([k, n]) => Array(Math.max(0, n)).fill(k)));
}
