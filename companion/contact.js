// Reporting a bug (docs/02 §8.7, point 4): a mailto: link with the subject and a body to fill in, plus what helps to
// reproduce it (the version, the language, web or Android app, the browser and, in a game, its code). On Android the
// app's WebView hands mailto: to the phone's mail app. With no address the link is not shown. As in 61.

import { t, getLang } from '../src/i18n/index.js';

/** Where the reports go: the public address the user already gives for the Normandy Companion's reports. */
export const CONTACT = 'plissken2013es@hotmail.com';
/** The version, shown in the credits and sent with each report; tools/build-companion.mjs copies it to package.json. */
export const VERSION = '0.1.0-beta';
/** The public repository: the code, its issues and pull requests. */
export const SOURCE = 'https://github.com/plissken2013es/britain-companion';

// mail clients cut long mailto: links (some at 2,000 characters): a longer game code goes by the clipboard
const MAX_URL = 1800;

/** The mailto: link for a report, from the address and, in a game, its code. */
export function bugMail(address, { code = null, app = 'web', agent = '' } = {}) {
    const subject = t('cmp.bug.subject');
    const lines = (withCode) => [
        t('cmp.bug.what'), '', '',
        '—',
        `${t('cmp.bug.app')}: ${VERSION} · ${app} · ${getLang()}`,
        agent ? `${t('cmp.bug.browser')}: ${agent}` : null,
        code ? `${t('cmp.bug.code')}: ${withCode ? code : t('cmp.bug.paste')}` : null,
    ].filter((l) => l != null).join('\n');
    const url = (withCode) => `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines(withCode))}`;
    const full = url(true);
    return full.length <= MAX_URL ? { url: full, clipboard: false } : { url: url(false), clipboard: true };
}

/** Web or the Android app. */
export const appKind = () => (globalThis.Capacitor?.isNativePlatform?.() ? 'android' : 'web');
