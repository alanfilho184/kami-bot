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
    throw new Error(
        `INSTANCE_TYPE inválido: ${instanceType ?? 'undefined'}. Use primary, secondary ou backup.`
    );
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
    INSTANCE_TYPE: instanceType as InstanceRole
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
        | 'A'
        | 'AAAA'
        | 'CNAME'
        | undefined;
    config.CLOUDFLARE_DNS_SECONDARY_CONTENT = process.env.CLOUDFLARE_DNS_SECONDARY_CONTENT;
    config.CLOUDFLARE_DNS_SECONDARY_PROXIED = process.env.CLOUDFLARE_DNS_SECONDARY_PROXIED !== 'false';
    config.CLOUDFLARE_DNS_BACKUP_TYPE = process.env.CLOUDFLARE_DNS_BACKUP_TYPE as 'A' | 'AAAA' | 'CNAME' | undefined;
    config.CLOUDFLARE_DNS_BACKUP_CONTENT = process.env.CLOUDFLARE_DNS_BACKUP_CONTENT;
    config.CLOUDFLARE_DNS_BACKUP_PROXIED = process.env.CLOUDFLARE_DNS_BACKUP_PROXIED !== 'false';
    config.CLOUDFLARE_DNS_TTL = Number(process.env.CLOUDFLARE_DNS_TTL) || 60;
}

export default config;
