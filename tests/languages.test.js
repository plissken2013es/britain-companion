// The other languages (src/i18n/lang/): each one is well formed (texts added later may be missing: they show in
// English), a new one starts complete, and the browser's preferred languages pick the right one. As in 61.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTRA_LANGS, LANGS, pickLang } from '../src/i18n/index.js';
import { checkLanguage, starter } from '../src/i18n/new-language.mjs';

for (const l of EXTRA_LANGS) {
    test(`lang/${l.code}.js is well formed`, () => {
        assert.deepEqual(checkLanguage(l).errors, []);
    });
}

test('a new language file starts complete, and a broken one is caught', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ubc-lang-'));
    try {
        const file = join(dir, 'zz.js');
        writeFileSync(file, starter('zz', 'Zedish'));
        const { default: l } = await import(pathToFileURL(file).href);
        assert.deepEqual(checkLanguage(l), { errors: [], missing: [] });
        assert.ok(Object.keys(l.texts).some((k) => k.startsWith('log.')) && Object.keys(l.texts).some((k) => k.startsWith('cmp.')));
        assert.ok(!Object.keys(l.texts).some((k) => /^(app|setup|campaign|catalog|help)\./.test(k)), 'no texts of the private app');
        const key = Object.keys(l.texts).find((k) => typeof l.texts[k] === 'string' && /\{\w+\}/.test(l.texts[k]));
        const broken = { ...l, code: 'en', scenarios: { ...l.scenarios }, texts: { ...l.texts, [key]: 'no placeholders' } };
        delete broken.scenarios.s01;
        const { errors, missing } = checkLanguage(broken);
        const problems = errors.join('\n');
        assert.match(problems, /already built in/);
        assert.deepEqual(missing, ['scenarios: "s01"']);
        assert.match(problems, new RegExp(`"${key.replace(/\./g, '\\.')}" must keep the placeholders`));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the browser languages pick the interface language, English if none fits', () => {
    assert.ok(LANGS.includes('es') && LANGS.includes('en'));
    assert.equal(pickLang(['es-ES', 'en']), 'es');
    assert.equal(pickLang(['en-GB']), 'en');
    assert.equal(pickLang(['tlh', 'es']), 'es');
    assert.equal(pickLang(['tlh']), 'en');
    assert.equal(pickLang([]), 'en');
});
