/**
 * Copia assets não-TypeScript (fontes NERV usadas no render do bot-status)
 * de src/ para dist/, já que o tsc só emite .js/.d.ts.
 */
const fs = require('node:fs');
const path = require('node:path');

const assets = ['resources/fonts'];

const projectRoot = path.resolve(__dirname, '..');
const from = path.join(projectRoot, 'src');
const to = path.join(projectRoot, 'dist');

const copyDir = (source, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const targetPath = path.join(target, entry.name);

        if (entry.isDirectory()) {
            copyDir(sourcePath, targetPath);
        } else if (entry.isFile()) {
            // .ts/.d.ts ja sao emitidos pelo tsc
            if (entry.name.endsWith('.ts')) continue;
            fs.copyFileSync(sourcePath, targetPath);
        }
    }
};

for (const asset of assets) {
    const source = path.join(from, asset);

    if (!fs.existsSync(source)) {
        console.warn(`[copy-assets] ignorado (nao encontrado): ${source}`);
        continue;
    }

    copyDir(source, path.join(to, asset));
    console.log(`[copy-assets] ${asset} -> ${path.relative(projectRoot, path.join(to, asset))}`);
}
