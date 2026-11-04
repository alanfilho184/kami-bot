// Teste de consistência i18n (puro Node, sem mocks, sem HTTP):
const fs = require('node:fs');
const path = require('node:path');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const LOCALIZATION_DIR = path.join(SRC_DIR, 'resources', 'localization');
const { sheetErrorKey } = require('../../src/resources/localization/sheet-errors');
const { localization } = require('../../src/resources/localization');

function collectTsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__mocks__' || entry.name === 'mocks' || entry.name === 'node_modules') {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectTsFiles(full));
        } else if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
            out.push(full);
        }
    }
    return out;
}

function stripComments(code) {
    const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, match => '\n'.repeat((match.match(/\n/g) || []).length));
    return noBlock
        .split('\n')
        .map(line => (/^\s*\/\//.test(line) ? '' : line))
        .join('\n');
}

const KEY_ARG = /localization\s*\(\s*[^,()]+,\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
const SHEET_ERROR_PUSH = /errors\.push\(\{\s*field:\s*'([^']+)',\s*code:\s*'([^']+)'\s*\}\)/g;

function extractUsages() {
    const usages = [];
    for (const file of collectTsFiles(SRC_DIR)) {
        const code = stripComments(fs.readFileSync(file, 'utf-8'));
        KEY_ARG.lastIndex = 0;
        let match;
        while ((match = KEY_ARG.exec(code)) !== null) {
            const template = match[1].slice(1, -1);
            usages.push({
                template,
                dynamic: template.includes('${'),
                file: path.relative(SRC_DIR, file).replace(/\\/g, '/'),
                line: code.slice(0, match.index).split('\n').length
            });
        }
    }
    return usages;
}

function loadLanguages() {
    return fs
        .readdirSync(LOCALIZATION_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(LOCALIZATION_DIR, entry.name, 'messages.json'))
        .filter(file => fs.existsSync(file))
        .map(file => ({
            lang: path.basename(path.dirname(file)),
            file: path.relative(SRC_DIR, file).replace(/\\/g, '/'),
            dict: JSON.parse(fs.readFileSync(file, 'utf-8'))
        }));
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateToRegExp(template) {
    return new RegExp(
        '^' +
            template
                .split(/\$\{[^}]*\}/)
                .map(escapeRegExp)
                .join('.*') +
            '$'
    );
}

describe('localization keys (src ↔ messages.json)', () => {
    const usages = extractUsages();
    const langFiles = loadLanguages();

    it('encontra usos de localization em src e idiomas com messages.json', () => {
        expect(usages.length).toBeGreaterThan(0);
        expect(langFiles.length).toBeGreaterThanOrEqual(2);
    });

    it('toda chave usada em src existe em todos os messages.json', () => {
        const problems = [];
        const byTemplate = new Map();
        for (const usage of usages) {
            const list = byTemplate.get(usage.template) || [];
            list.push(usage);
            byTemplate.set(usage.template, list);
        }

        for (const [template, list] of byTemplate) {
            const where = list.map(u => `${u.file}:${u.line}`).join(', ');
            if (!list[0].dynamic) {
                const missing = langFiles.filter(l => !(template in l.dict)).map(l => l.lang);
                if (missing.length > 0) {
                    problems.push(`"${template}" usada em ${where} — ausente em: ${missing.join(', ')}`);
                }
            } else {
                const pattern = templateToRegExp(template);
                const unmatched = langFiles
                    .filter(l => !Object.keys(l.dict).some(key => pattern.test(key)))
                    .map(l => l.lang);
                if (unmatched.length > 0) {
                    problems.push(
                        `padrão "${template}" usado em ${where} — sem chave correspondente em: ${unmatched.join(', ')}`
                    );
                }
            }
        }

        expect(problems).toEqual([]);
    });

    it('sheetErrorKey evita prefixo duplicado do campo', () => {
        expect(sheetErrorKey('attribute', 'attribute-not-found')).toBe('sheet|attribute-not-found');
        expect(sheetErrorKey('section', 'section-not-found')).toBe('sheet|section-not-found');
        expect(sheetErrorKey('attribute', 'type-mismatch')).toBe('sheet|attribute-type-mismatch');
        expect(sheetErrorKey('attribute', 'name-size')).toBe('sheet|attribute-name-size');
    });

    it('todo par field/code de erro de ficha tem chave de tradução', () => {
        const combos = new Set();
        for (const file of collectTsFiles(SRC_DIR)) {
            if (!/sheet/i.test(path.basename(file))) continue;
            const code = stripComments(fs.readFileSync(file, 'utf-8'));
            SHEET_ERROR_PUSH.lastIndex = 0;
            let match;
            while ((match = SHEET_ERROR_PUSH.exec(code)) !== null) {
                combos.add({ field: match[1], code: match[2] });
            }
        }

        expect(combos.size).toBeGreaterThan(0);

        const problems = [];
        for (const { field, code } of combos) {
            const key = sheetErrorKey(field, code);
            const missing = langFiles.filter(l => !(key in l.dict)).map(l => l.lang);
            if (missing.length > 0) {
                problems.push(
                    `"${key}" (field=${field}, code=${code}) usada em src — ausente em: ${missing.join(', ')}`
                );
            }
        }

        expect(problems).toEqual([]);
    });

    it('comandos de ficha não montam a chave de erro manualmente', () => {
        const offenders = [];
        for (const file of collectTsFiles(SRC_DIR)) {
            const code = stripComments(fs.readFileSync(file, 'utf-8'));
            if (code.includes('${err.field}-${err.code}')) {
                offenders.push(path.relative(SRC_DIR, file).replace(/\\/g, '/'));
            }
        }

        expect(offenders).toEqual([]);
    });

    it('todos os messages.json têm o mesmo conjunto de chaves', () => {
        const problems = [];
        const allKeys = new Set();
        for (const lang of langFiles) {
            for (const key of Object.keys(lang.dict)) {
                allKeys.add(key);
            }
        }

        for (const lang of langFiles) {
            const missing = [...allKeys].filter(key => key !== 'language' && !(key in lang.dict));
            if (missing.length > 0) {
                problems.push(`${lang.lang} (${lang.file}) não tem: ${missing.join(', ')}`);
            }
        }

        expect(problems).toEqual([]);
    });

    it('chave ausente retorna fallback em vez de lançar', () => {
        expect(localization('en-us', 'sheet|chave-que-nao-existe')).toBe('Localization error');
    });

    it('idioma desconhecido retorna fallback em vez de lançar', () => {
        expect(localization('xx-xx', 'help|title')).toBe('Localization error');
    });

    it('nenhum valor de tradução está vazio', () => {
        const problems = [];
        for (const lang of langFiles) {
            for (const [key, value] of Object.entries(lang.dict)) {
                if (key === 'language') {
                    continue;
                }
                const empty =
                    (typeof value === 'string' && value.trim() === '') ||
                    (Array.isArray(value) &&
                        (value.length === 0 || !value.some(v => typeof v === 'string' && v.trim() !== ''))) ||
                    (typeof value !== 'string' && !Array.isArray(value));
                if (empty) {
                    problems.push(`${lang.lang}: "${key}" está vazio ou tem tipo inesperado`);
                }
            }
        }

        expect(problems).toEqual([]);
    });
});
