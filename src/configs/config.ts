import dotenv from 'dotenv';
import { Discord_Id, Channel_Id, Msg_Id } from '../types/validations';
import { isInstanceRole, type InstanceRole } from '../types/instance';
import process from 'node:process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.NODE_ENV === 'production') {
    dotenv.config({ path: 'prod.env' });
} else if (process.env.NODE_ENV === 'test') {
    dotenv.config({ path: 'test.env' });
} else {
    dotenv.config({ path: '.env' });
}

const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), { encoding: 'utf-8' }));

const instanceType = process.env.INSTANCE_TYPE;

if (!isInstanceRole(instanceType)) {
    throw new Error(`INSTANCE_TYPE inválido: ${instanceType ?? 'undefined'}. Use primary, secondary ou backup.`);
}

function normalizeLoggerUrl(value: string | undefined): string | undefined {
    const trimmed = value?.trim();

    if (!trimmed) {
        return undefined;
    }

    return trimmed.replace(/\/socket\.io\/?$/, '').replace(/\/+$/, '');
}

function isValidHttpUrl(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function requireNonEmpty(
    errors: string[],
    name: string,
    value: string | undefined,
    options: { minLength?: number } = {}
): void {
    const trimmed = value?.trim();

    if (!trimmed) {
        errors.push(`${name} é obrigatória`);
        return;
    }

    if (options.minLength && trimmed.length < options.minLength) {
        errors.push(`${name} deve ter pelo menos ${options.minLength} caracteres`);
    }
}

const config: EnvVars = {
    NODE_ENV: process.env.NODE_ENV as 'development' | 'production' | 'test',
    DATABASE_URL: process.env.DATABASE_URL as string,
    PORT: Number(process.env.PORT),
    BOT_TOKEN: process.env.BOT_TOKEN as string,
    PUBLIC_KEY: process.env.PUBLIC_KEY as string,
    CLIENT_ID: new Discord_Id(process.env.CLIENT_ID as string),
    CLIENT_SECRET: process.env.CLIENT_SECRET as string,
    OWNER_ID: new Discord_Id(process.env.OWNER_ID as string),
    LOG_CHANNEL_ID: new Channel_Id(process.env.LOG_CHANNEL_ID as string),
    COMMAND_WEBHOOK_ID: new Discord_Id(process.env.COMMAND_WEBHOOK_ID as string),
    COMMAND_WEBHOOK_TOKEN: process.env.COMMAND_WEBHOOK_TOKEN as string,
    LOG_WEBHOOK_ID: new Discord_Id(process.env.LOG_WEBHOOK_ID as string),
    LOG_WEBHOOK_TOKEN: process.env.LOG_WEBHOOK_TOKEN as string,
    BOT_STATUS_CHANNEL_ID: new Channel_Id(process.env.BOT_STATUS_CHANNEL_ID as string),
    BOT_STATUS_MESSAGE_ID: new Msg_Id(process.env.BOT_STATUS_MESSAGE_ID as string),
    EMBED_COLOR: process.env.EMBED_COLOR as string,
    VERSION: packageJson.version || (process.env.version as string),
    API_TOKEN: process.env.API_TOKEN as string,
    KAMI_SITE_URL: (process.env.KAMI_SITE_URL || 'https://kamiapp.com.br').trim().replace(/\/+$/, ''),
    BOT_SYNC_TOKEN: process.env.BOT_SYNC_TOKEN?.trim() || '',
    INSTANCE_TYPE: instanceType as InstanceRole,
    LOGGER_URL: normalizeLoggerUrl(process.env.LOGGER_URL),
    LOGGER_TOKEN: process.env.LOGGER_TOKEN?.trim() || undefined,
    INSTANCE_NAME: process.env.INSTANCE_NAME?.trim() || instanceType
};

if (config.INSTANCE_TYPE !== 'primary') {
    config.PRIMARY_INSTANCE_STATUS_URL = process.env.PRIMARY_INSTANCE_STATUS_URL as string;
    config.PRIMARY_INSTANCE_API_TOKEN = process.env.PRIMARY_INSTANCE_API_TOKEN as string;
    config.SECONDARY_INSTANCE_STATUS_URL = process.env.SECONDARY_INSTANCE_STATUS_URL as string;
    config.SECONDARY_INSTANCE_API_TOKEN = process.env.SECONDARY_INSTANCE_API_TOKEN as string;

    // Cloudflare DNS failover
    config.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
    config.CLOUDFLARE_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
    config.CLOUDFLARE_DNS_RECORD_NAME = process.env.CLOUDFLARE_DNS_RECORD_NAME;
    config.CLOUDFLARE_DNS_PRIMARY_TYPE = process.env.CLOUDFLARE_DNS_PRIMARY_TYPE as 'A' | 'AAAA' | 'CNAME' | undefined;
    config.CLOUDFLARE_DNS_PRIMARY_CONTENT = process.env.CLOUDFLARE_DNS_PRIMARY_CONTENT;
    config.CLOUDFLARE_DNS_PRIMARY_PROXIED = process.env.CLOUDFLARE_DNS_PRIMARY_PROXIED !== 'false';
    config.CLOUDFLARE_DNS_SECONDARY_TYPE = process.env.CLOUDFLARE_DNS_SECONDARY_TYPE as
        'A' | 'AAAA' | 'CNAME' | undefined;
    config.CLOUDFLARE_DNS_SECONDARY_CONTENT = process.env.CLOUDFLARE_DNS_SECONDARY_CONTENT;
    config.CLOUDFLARE_DNS_SECONDARY_PROXIED = process.env.CLOUDFLARE_DNS_SECONDARY_PROXIED !== 'false';
    config.CLOUDFLARE_DNS_BACKUP_TYPE = process.env.CLOUDFLARE_DNS_BACKUP_TYPE as 'A' | 'AAAA' | 'CNAME' | undefined;
    config.CLOUDFLARE_DNS_BACKUP_CONTENT = process.env.CLOUDFLARE_DNS_BACKUP_CONTENT;
    config.CLOUDFLARE_DNS_BACKUP_PROXIED = process.env.CLOUDFLARE_DNS_BACKUP_PROXIED !== 'false';
    config.CLOUDFLARE_DNS_TTL = Number(process.env.CLOUDFLARE_DNS_TTL) || 60;
}

function failConfig(errors: string[]): never {
    const message = `Configuração inválida:\n- ${errors.join('\n- ')}`;

    console.error(message);

    if (process.env.NODE_ENV === 'test') {
        throw new Error(message);
    }

    process.exit(1);
}

const validationErrors: string[] = [];

const validNodeEnvs = ['development', 'production', 'test'];
if (!config.NODE_ENV || !validNodeEnvs.includes(config.NODE_ENV)) {
    validationErrors.push(`NODE_ENV deve ser um de: ${validNodeEnvs.join(', ')}`);
}

const isTestEnv = process.env.NODE_ENV === 'test';
const portIsValid = Number.isInteger(config.PORT) && config.PORT >= (isTestEnv ? 0 : 1) && config.PORT <= 65535;
if (!portIsValid) {
    validationErrors.push('PORT deve ser um inteiro entre 1 e 65535');
}

requireNonEmpty(validationErrors, 'DATABASE_URL', config.DATABASE_URL);
requireNonEmpty(validationErrors, 'BOT_TOKEN', config.BOT_TOKEN);
requireNonEmpty(validationErrors, 'PUBLIC_KEY', config.PUBLIC_KEY);
requireNonEmpty(validationErrors, 'CLIENT_SECRET', config.CLIENT_SECRET);
requireNonEmpty(validationErrors, 'API_TOKEN', config.API_TOKEN);
requireNonEmpty(validationErrors, 'COMMAND_WEBHOOK_TOKEN', config.COMMAND_WEBHOOK_TOKEN);
requireNonEmpty(validationErrors, 'LOG_WEBHOOK_TOKEN', config.LOG_WEBHOOK_TOKEN);

if (config.DATABASE_URL && !/^postgres(ql)?:\/\//i.test(config.DATABASE_URL)) {
    validationErrors.push('DATABASE_URL deve ser uma URL PostgreSQL');
}

if (config.PUBLIC_KEY && !/^[0-9a-f]{64}$/i.test(config.PUBLIC_KEY)) {
    validationErrors.push('PUBLIC_KEY deve ter 64 caracteres hexadecimais');
}

const embedColor = Number(config.EMBED_COLOR);
if (!Number.isInteger(embedColor) || embedColor < 0 || embedColor > 0xffffff) {
    validationErrors.push('EMBED_COLOR deve ser uma cor hexadecimal (ex.: 0x0082FF)');
}

if (!isValidHttpUrl(config.KAMI_SITE_URL)) {
    validationErrors.push('KAMI_SITE_URL deve ser uma URL http(s) válida');
}

if (!!config.LOGGER_URL !== !!config.LOGGER_TOKEN) {
    validationErrors.push('LOGGER_URL e LOGGER_TOKEN devem ser definidos juntos');
}

if (config.LOGGER_URL) {
    if (!isValidHttpUrl(config.LOGGER_URL)) {
        validationErrors.push('LOGGER_URL deve ser uma URL http(s) válida');
    } else if (config.NODE_ENV === 'production' && new URL(config.LOGGER_URL).protocol !== 'https:') {
        validationErrors.push('LOGGER_URL deve usar https em produção');
    }
}

if (config.LOGGER_TOKEN && !config.LOGGER_TOKEN.startsWith('klp_')) {
    validationErrors.push('LOGGER_TOKEN deve começar com "klp_"');
}

for (const [name, value] of [
    ['PRIMARY_INSTANCE_STATUS_URL', config.PRIMARY_INSTANCE_STATUS_URL],
    ['SECONDARY_INSTANCE_STATUS_URL', config.SECONDARY_INSTANCE_STATUS_URL]
] as const) {
    if (value && !isValidHttpUrl(value)) {
        validationErrors.push(`${name} deve ser uma URL http(s) válida`);
    }
}

if (
    config.CLOUDFLARE_DNS_TTL !== undefined &&
    (!Number.isInteger(config.CLOUDFLARE_DNS_TTL) || config.CLOUDFLARE_DNS_TTL < 1)
) {
    validationErrors.push('CLOUDFLARE_DNS_TTL deve ser um inteiro positivo');
}

if (validationErrors.length > 0) {
    failConfig(validationErrors);
}

export default config;
