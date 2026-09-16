// Teste de consistência i18n (puro Node, sem mocks, sem HTTP):
// varre todos os arquivos de src, extrai as chaves usadas em localization()
// e garante que todas existem em TODOS os messages.json (pt-br, en-us, ...).
//
// Cobre literais ('roll|title') e templates dinâmicos (`help|${cmd}-title`,
// `sheet|${err.field}-${err.code}`) — estes viram regex e precisam de ao
// menos uma chave correspondente por idioma. Comentários são ignorados.
import fs from 'node:fs';
import path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '..', '..', 'src');
const LOCALIZATION_DIR = path.join(SRC_DIR, 'resources', 'localization');

interface KeyUsage {
    template: string;
    dynamic: boolean;
    file: string;
    line: number;
}

interface LangFile {
    lang: string;
    file: string;
    dict: Record<string, unknown>;
}

function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
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

/** Remove comentários preservando números de linha. */
function stripComments(code: string): string {
    const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, match => '\n'.repeat((match.match(/\n/g) || []).length));
    return noBlock
        .split('\n')
        .map(line => (/^\s*\/\//.test(line) ? '' : line))
        .join('\n');
}

// localization(<primeiro arg sem vírgula/parênteses>, <'..."...' ou `...`>)
const KEY_ARG = /localization\s*\(\s*[^,()]+,\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;

function extractUsages(): KeyUsage[] {
    const usages: KeyUsage[] = [];
    for (const file of collectTsFiles(SRC_DIR)) {
        const code = stripComments(fs.readFileSync(file, 'utf-8'));
        KEY_ARG.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = KEY_ARG.exec(code)) !== null) {
            const template = match[1].slice(1, -1); // remove aspas/crase
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

function loadLanguages(): LangFile[] {
    return fs
        .readdirSync(LOCALIZATION_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(LOCALIZATION_DIR, entry.name, 'messages.json'))
        .filter(file => fs.existsSync(file))
        .map(file => ({
            lang: path.basename(path.dirname(file)),
            file: path.relative(SRC_DIR, file).replace(/\\/g, '/'),
            dict: JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
        }));
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `help|${cmd}-title` => /^help\|.*-title$/ */
function templateToRegExp(template: string): RegExp {
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
        const problems: string[] = [];
        const byTemplate = new Map<string, KeyUsage[]>();
        for (const usage of usages) {
            const list = byTemplate.get(usage.template) ?? [];
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

    it('todos os messages.json têm o mesmo conjunto de chaves', () => {
        const problems: string[] = [];
        const allKeys = new Set<string>();
        for (const lang of langFiles) {
            for (const key of Object.keys(lang.dict)) {
                allKeys.add(key);
            }
        }

        for (const lang of langFiles) {
            // 'language' é metadado (valor difere por arquivo); demais chaves devem ser iguais.
            const missing = [...allKeys].filter(key => key !== 'language' && !(key in lang.dict));
            if (missing.length > 0) {
                problems.push(`${lang.lang} (${lang.file}) não tem: ${missing.join(', ')}`);
            }
        }

        expect(problems).toEqual([]);
    });

    it('nenhum valor de tradução está vazio', () => {
        const problems: string[] = [];
        for (const lang of langFiles) {
            for (const [key, value] of Object.entries(lang.dict)) {
                if (key === 'language') {
                    continue;
                }
                // Arrays usam "" como separador de parágrafo (join com \n),
                // então vale ter ao menos um trecho não-vazio.
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
