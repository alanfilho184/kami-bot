// CLI manual de DNS: não passa pelo take-over e funciona em qualquer NODE_ENV.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const commands = ['status', 'primary', 'backup'];
const command = args.find(arg => commands.includes(arg));
const yes = args.includes('--yes');
const dryRun = !yes || args.includes('--dry-run');
const envArg = args.find(arg => arg.startsWith('--env='));
const envName = envArg ? envArg.slice('--env='.length) : process.env.NODE_ENV === 'production' ? 'prod' : 'dev';

if (!command) {
    console.error('Uso: node scripts/dns-switch.js <status|primary|backup> [--env=dev|prod] [--yes] [--dry-run]');
    process.exit(1);
}

if (!['dev', 'prod'].includes(envName)) {
    console.error(`Ambiente inválido: ${envName}. Use dev ou prod.`);
    process.exit(1);
}

const envPath = path.join(root, envName === 'prod' ? 'prod.env' : '.env');

if (!fs.existsSync(envPath)) {
    console.error(`Arquivo de ambiente não encontrado: ${envPath}`);
    process.exit(1);
}

dotenv.config({ path: envPath });

const distPath = path.join(root, 'dist', 'modules', 'cloudflare-dns.js');

if (!fs.existsSync(distPath)) {
    console.error('Módulo compilado não encontrado. Rode "npm run build" antes.');
    process.exit(1);
}

const { CloudflareDns } = require(distPath);

const proxied = value => value !== 'false';
const recordName = process.env.CLOUDFLARE_DNS_RECORD_NAME || '';
const dns = new CloudflareDns({
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    zoneId: process.env.CLOUDFLARE_ZONE_ID || '',
    recordName,
    ttl: Number(process.env.CLOUDFLARE_DNS_TTL) || 60,
    targets: {
        primary: {
            type: process.env.CLOUDFLARE_DNS_PRIMARY_TYPE || 'CNAME',
            content: process.env.CLOUDFLARE_DNS_PRIMARY_CONTENT || '',
            proxied: proxied(process.env.CLOUDFLARE_DNS_PRIMARY_PROXIED)
        },
        backup: {
            type: process.env.CLOUDFLARE_DNS_BACKUP_TYPE || 'CNAME',
            content: process.env.CLOUDFLARE_DNS_BACKUP_CONTENT || '',
            proxied: proxied(process.env.CLOUDFLARE_DNS_BACKUP_PROXIED)
        }
    }
});

function printRecords(records) {
    if (!records.length) {
        console.log('  (nenhum registro encontrado)');
        return;
    }

    for (const record of records) {
        console.log(
            `  ${record.type} ${record.name} -> ${record.content} (proxied=${record.proxied}, ttl=${record.ttl})`
        );
    }
}

async function main() {
    if (!dns.isConfigured) {
        console.error(
            'Cloudflare DNS não configurado. Verifique CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, ' +
                'CLOUDFLARE_DNS_RECORD_NAME, CLOUDFLARE_DNS_PRIMARY_CONTENT e CLOUDFLARE_DNS_BACKUP_CONTENT.'
        );
        process.exitCode = 1;
        return;
    }

    if (command === 'status') {
        console.log(`Registro: ${recordName}`);
        console.log('Estado atual:');
        printRecords(await dns.getRecords());
        return;
    }

    const result = await dns.apply(command, { dryRun });

    console.log(`Registro: ${recordName}`);
    console.log(`Alvo: ${command}`);
    console.log('Estado atual:');
    printRecords(result.current);
    console.log(`Desejado: ${result.desired.type} ${result.desired.content} (proxied=${result.desired.proxied})`);
    console.log(`Ação: ${result.action}`);

    if (!result.ok) {
        console.error(`Falha: ${result.error}`);
        process.exitCode = 1;
        return;
    }

    if (!result.changed) {
        console.log('O registro já está no estado desejado.');
        return;
    }

    if (dryRun) {
        console.log('Dry-run: nenhuma alteração foi feita. Use --yes para aplicar.');
        return;
    }

    console.log('Aplicado com sucesso.');
    console.log(`Valide com: curl https://${recordName}/health/status`);
}

main().catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
});
