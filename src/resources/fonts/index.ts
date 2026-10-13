import fs from 'node:fs';
import path from 'node:path';

/**
 * Fontes do design system NERV (Neon Genesis Evangelion UI), embutidas no SVG
 * via @font-face + base64 para que o render seja idêntico em qualquer servidor.
 *
 * Ambas são SIL Open Font License 1.1 (ver OFL-Oswald.txt / OFL-FiraCode.txt).
 */

interface FontFace {
    family: string;
    file: string;
    weight: number;
}

const FACES: FontFace[] = [
    { family: 'NervDisplay', file: 'Oswald-Regular.ttf', weight: 400 },
    { family: 'NervDisplay', file: 'Oswald-SemiBold.ttf', weight: 600 },
    { family: 'NervDisplay', file: 'Oswald-Bold.ttf', weight: 700 },
    { family: 'NervMono', file: 'FiraCode-Regular.ttf', weight: 400 },
    { family: 'NervMono', file: 'FiraCode-Bold.ttf', weight: 700 }
];

const searchDirs = (): string[] => [
    __dirname,
    path.join(__dirname, '..', '..', '..', 'src', 'resources', 'fonts'),
    path.join(process.cwd(), 'dist', 'resources', 'fonts'),
    path.join(process.cwd(), 'src', 'resources', 'fonts')
];

let cache: string | null = null;
let loaded = false;

const resolveFont = (file: string): string | null => {
    for (const dir of searchDirs()) {
        const full = path.join(dir, file);
        try {
            if (fs.existsSync(full)) return fs.readFileSync(full).toString('base64');
        } catch {
            // ignora e tenta o próximo diretório
        }
    }
    return null;
};

/** CSS com os @font-face das fontes NERV (vazio se os arquivos não existirem). */
export const getFontFacesCss = (): string => {
    if (cache !== null) return cache;

    const rules: string[] = [];
    for (const face of FACES) {
        const base64 = resolveFont(face.file);
        if (!base64) continue;
        rules.push(
            `@font-face { font-family: '${face.family}'; src: url(data:font/ttf;base64,${base64}) format('truetype'); font-weight: ${face.weight}; font-style: normal; }`
        );
    }

    cache = rules.join('\n');
    loaded = rules.length > 0;

    if (!loaded) {
        console.warn(
            '[status-image] Fontes NERV não encontradas em:',
            searchDirs().join(', '),
            '- usando fontes do sistema.'
        );
    }

    return cache;
};

/** true quando os TTF foram encontrados e embutidos no SVG. */
export const areFontsLoaded = (): boolean => {
    getFontFacesCss();
    return loaded;
};

/**
 * Nomes de família para uso nos elementos SVG.
 * O fallback prioriza fontes condensadas presentes em Ubuntu/Debian
 * (Liberation Sans Narrow, DejaVu Sans Condensed) para o layout não estourar
 * caso os TTF não sejam encontrados no deploy.
 */
export const FONT_DISPLAY =
    "'NervDisplay', Oswald, 'Arial Narrow', 'Liberation Sans Narrow', 'DejaVu Sans Condensed', 'Roboto Condensed', Impact, sans-serif";
export const FONT_MONO =
    "'NervMono', 'Fira Code', Consolas, 'JetBrains Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace";
