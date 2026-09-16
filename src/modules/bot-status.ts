import { DateTime } from 'luxon';
import asciiTable from 'ascii-table';
import db from '../configs/database';
import config from '../configs/config';
import ms from 'ms';
import rest from '../configs/rest';
import { Routes } from 'discord-api-types/v10';
import { EmbedBuilder } from '@discordjs/builders';
import os from 'os-utils';
import logger from '../configs/logger';
import { localization } from '../resources/localization';
import { Available_Languages } from '../types/enums';
import { performance } from 'node:perf_hooks';

class BotStatus {
    statusMessageId: string | null = null;
    statusChannelId: string | null = null;
    dbData: any = null;
    discordData: any = null;
    private timers: NodeJS.Timeout[] = [];
    private enabled: boolean = false;

    get isActive(): boolean {
        return this.enabled;
    }

    enable(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;

        void this.getDbData();
        this.timers.push(
            setInterval(() => {
                void this.getDbData();
            }, ms('10m'))
        );

        void this.getDiscordData();
        this.timers.push(
            setInterval(() => {
                void this.getDiscordData();
            }, ms('1h'))
        );

        this.timers.push(
            setTimeout(() => {
                void this.updateStatusMessage();
                this.timers.push(
                    setInterval(() => {
                        void this.updateStatusMessage();
                    }, ms('1m'))
                );
            }, ms('1m'))
        );
    }

    disable(): void {
        this.enabled = false;

        for (const timer of this.timers) {
            clearInterval(timer);
            clearTimeout(timer);
        }

        this.timers = [];
    }

    private lastCpuUsage: NodeJS.CpuUsage = process.cpuUsage();
    private lastSampleTime: number = performance.now();

    public getProcessStats(): { memory: number; cpu: string } {
        const cpu = process.cpuUsage();
        const now = performance.now();
        const deltaUs = cpu.user - this.lastCpuUsage.user + (cpu.system - this.lastCpuUsage.system);
        const deltaMs = now - this.lastSampleTime;
        this.lastCpuUsage = cpu;
        this.lastSampleTime = now;

        const percent = Math.min(deltaMs > 0 ? (deltaUs / (1000 * deltaMs)) * 100 : 0, 100);
        return {
            memory: process.memoryUsage().rss / (1024 * 1024), // MB
            cpu: percent.toFixed(2)
        };
    }

    async getDbData() {
        let pingStart = Date.now();
        const data = (
            (await db.$queryRawUnsafe(`
                WITH 
                    log_metrics AS (
                        SELECT
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' AND timestamp >= NOW() - INTERVAL '24 hours' THEN 1 
                                END) AS total_commands_24h,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' AND timestamp >= NOW() - INTERVAL '24 hours' THEN 1 
                                END) AS total_components_24h,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' AND timestamp >= NOW() - INTERVAL '30 days' THEN 1 
                                END) AS total_commands_30d,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' AND timestamp >= NOW() - INTERVAL '30 days' THEN 1 
                                END) AS total_components_30d,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' 
                                AND timestamp >= DATE_TRUNC('month', NOW() - INTERVAL '1 month') 
                                AND timestamp < DATE_TRUNC('month', NOW()) 
                                THEN 1 
                                END) AS total_commands_prev_month,

                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' 
                                AND timestamp >= DATE_TRUNC('month', NOW() - INTERVAL '1 month') 
                                AND timestamp < DATE_TRUNC('month', NOW()) 
                                THEN 1 
                                END) AS total_components_prev_month

                        FROM
                            logs
                        WHERE
                            timestamp >= NOW() - INTERVAL '60 days'
                    ),
                    total_logs as (
                        SELECT 
                            COUNT(CASE
                                WHEN action_type = 'COMMAND'
                                THEN 1
                                END
                            ) as total_commands,

                            COUNT(CASE
                                WHEN action_type = 'COMPONENT'
                                THEN 1
                                END
                            ) as total_components
                        FROM
                            logs
                    )

                    SELECT
                        (SELECT COUNT(id) FROM users) AS total_users,
                        (SELECT COUNT(id) FROM users WHERE last_use >= NOW() - INTERVAL '30 days') AS total_active_users,
                        (SELECT COUNT(id) FROM sheets) AS total_sheets_created,

                        t.total_commands AS total_commands,
                        t.total_components AS total_components,
                        l.total_commands_24h AS total_commands_today,
                        l.total_components_24h AS total_components_today,
                        l.total_commands_30d AS total_commands_month,
                        l.total_components_30d AS total_components_month,
                        
                        l.total_commands_prev_month AS total_commands_prev_month,
                        l.total_components_prev_month AS total_components_prev_month
                    FROM
                        log_metrics l
                    CROSS JOIN
                        total_logs t;	
                        ;
        `)) as {
                total_users: number;
                total_active_users: number;
                total_sheets_created: number;
                total_commands: number;
                total_components: number;
                total_commands_today: number;
                total_components_today: number;
                total_commands_month: number;
                total_components_month: number;
                total_commands_prev_month: number;
                total_components_prev_month: number;
            }[]
        )[0];
        let pingEnd = Date.now();

        this.dbData = {
            totalUsers: data.total_users,
            totalActiveUsers: data.total_active_users,
            totalSheetsCreated: data.total_sheets_created,
            totalCommands: Number(data.total_commands) + 803_410, //O BOT antigo só mantinha contagem simples de comandos
            totalComponents: Number(data.total_components) + 120_647, //O BOT antigo só mantinha contagem simples de componentes
            totalCommandsToday: data.total_commands_today,
            totalComponentsToday: data.total_components_today,
            totalCommandsMonth: data.total_commands_month,
            totalComponentsMonth: data.total_components_month,
            totalCommandsPrevMonth: data.total_commands_prev_month,
            totalComponentsPrevMonth: data.total_components_prev_month,
            dbPing: pingEnd - pingStart
        };
    }

    async getDiscordData() {
        let pingStart = Date.now();
        const applicationPartial = (await rest.get(Routes.currentApplication())) as {
            approximate_guild_count: number;
            approximate_user_install_count: number;
            approximate_user_authorization_count: number;
        };
        let pingEnd = Date.now();

        this.discordData = {
            approximateGuildCount: applicationPartial.approximate_guild_count,
            approximateUserInstallCount: applicationPartial.approximate_user_install_count,
            approximateUserAuthorizationCount: applicationPartial.approximate_user_authorization_count,
            restPing: pingEnd - pingStart
        };
    }

    async buildTable() {
        const tableGeneral = new asciiTable('Kami BOT - Status');

        let uptime = process.uptime();
        let days = Math.floor((uptime % 31536000) / 86400);
        let hours = Math.floor((uptime % 86400) / 3600);
        let minutes = Math.floor((uptime % 3600) / 60);
        let botuptime =
            (days > 0 ? (days == 1 ? days + ' dia ' : days + ' dias ') : '') +
            (hours > 0 ? (hours == 1 ? hours + ' hora ' : hours + ' horas ') : '') +
            (minutes > 0 ? (minutes == 1 ? minutes + ' minuto ' : minutes + ' minutos ') : '');

        const stats = this.getProcessStats();
        const ram = stats.memory.toFixed(2);
        const cpu = stats.cpu;

        const totalInteractionsMonth = parseInt(this.dbData?.totalCommandsMonth + this.dbData?.totalComponentsMonth);
        const totalInteractionsPrevMonth = parseInt(
            this.dbData?.totalCommandsPrevMonth + this.dbData?.totalComponentsPrevMonth
        );

        let interactionsGrowth = totalInteractionsPrevMonth
            ? ((totalInteractionsMonth - totalInteractionsPrevMonth) / totalInteractionsPrevMonth) * 100
            : 'N/A';

        if (typeof interactionsGrowth != 'string') {
            if (interactionsGrowth == 0) {
                interactionsGrowth = `→ 0.00 %`;
            } else if (interactionsGrowth > 0) {
                interactionsGrowth = `↑ ${interactionsGrowth.toFixed(2)} %`;
            } else {
                interactionsGrowth = `↓ ${Math.abs(interactionsGrowth).toFixed(2)} %`;
            }
        }

        tableGeneral.addRow('Uso de CPU', `${cpu} %`);
        tableGeneral.addRow('Uso de RAM', `${ram} MB`);
        tableGeneral.addRow(
            'Ram Total',
            `${(os.totalmem() / 1024 - os.freemem() / 1024).toFixed(1)} GB / ${(os.totalmem() / 1024).toFixed(1)} GB`
        );
        tableGeneral.addRow(
            'Ping',
            `REST API: ${this.discordData?.restPing ? this.discordData.restPing + ' ms' : 'N/A'} - DB: ${this.dbData?.dbPing ? this.dbData.dbPing + ' ms' : 'N/A'}`
        );
        tableGeneral.addRow(' '.repeat(16), ' '.repeat(33));
        tableGeneral.addRow('Servidores', `${this.discordData?.approximateGuildCount}`);
        tableGeneral.addRow('Usuários', `${this.dbData?.totalUsers}`);
        tableGeneral.addRow('Usuários Ativos', `${this.dbData?.totalActiveUsers} (Últimos 30 dias)`);
        tableGeneral.addRow('Fichas Criadas', `${this.dbData?.totalSheetsCreated} Fichas`);

        const tableInteractions = new asciiTable('Interações');
        tableInteractions.setAlign(1, asciiTable.CENTER);
        tableInteractions.setAlign(2, asciiTable.CENTER);
        tableInteractions.setAlign(3, asciiTable.CENTER);
        tableInteractions.setAlign(4, asciiTable.CENTER);

        tableInteractions.setHeading('', 'Comandos', 'Componentes', 'Total');
        tableInteractions.addRow(' '.repeat(11), ' '.repeat(9), ' '.repeat(10), ' '.repeat(7));
        tableInteractions.addRow(
            'Últimas 24 horas',
            `${this.dbData?.totalCommandsToday}`,
            `${this.dbData?.totalComponentsToday}`,
            `${this.dbData?.totalCommandsToday + this.dbData?.totalComponentsToday}`
        );
        tableInteractions.addRow(
            'Últimos 30 dias',
            `${this.dbData?.totalCommandsMonth}`,
            `${this.dbData?.totalComponentsMonth}`,
            `${totalInteractionsMonth}`
        );
        tableInteractions.addRow(
            'Mês Anterior',
            `${this.dbData?.totalCommandsPrevMonth}`,
            `${this.dbData?.totalComponentsPrevMonth}`,
            `${totalInteractionsPrevMonth}`
        );
        tableInteractions.addRow(
            'Desde o início',
            `${this.dbData?.totalCommands}`,
            `${this.dbData?.totalComponents}`,
            `${this.dbData?.totalCommands + this.dbData?.totalComponents}`
        );

        const tableFooter = new asciiTable();
        tableFooter.addRow('Variação Mensal', interactionsGrowth);
        tableFooter.addRow(' '.repeat(16), ' '.repeat(33));
        tableFooter.addRow('Versão do Kami', `v${config.VERSION}`);
        tableFooter.addRow('Node.js', `${process.version}`);
        tableFooter.addRow('', '');
        tableFooter.addRow('Tempo Online', botuptime);

        let tableGeneralString = tableGeneral.toString() as string;
        let tableGeneralArray = tableGeneralString.split('\n');
        tableGeneralArray.pop();
        tableGeneralString = tableGeneralArray.join('\n');

        let tableInteractionsString = tableInteractions.toString() as string;
        tableInteractionsString = tableInteractionsString.split(`.`).join('|');
        tableInteractionsString = tableInteractionsString.split(`'`).join('|');

        let tableFooterString = tableFooter.toString() as string;
        let tableFooterArray = tableFooterString.split('\n');
        tableFooterArray.splice(0, 1);
        tableFooterString = tableFooterArray.join('\n');

        return tableGeneralString + '\n' + tableInteractionsString + '\n' + tableFooterString;
    }

    async updateStatusMessage() {
        if (!this.enabled) return;
        if (!config.BOT_STATUS_CHANNEL_ID || !config.BOT_STATUS_MESSAGE_ID) {
            console.warn('Bot status channel ID or message ID not configured. Skipping status update.');
            return;
        } else {
            if (this.dbData === null || this.discordData === null) {
                console.warn('Bot status data not loaded yet. Skipping status update.');
                return;
            } else {
                try {
                    const table = await this.buildTable();
                    const content = `\`\`\`\n${table}\`\`\``;

                    const botStatusEmbed = new EmbedBuilder();
                    botStatusEmbed.setColor(parseInt(config.EMBED_COLOR));
                    botStatusEmbed.setTitle('Status do Kami BOT');
                    botStatusEmbed.setDescription(content);
                    botStatusEmbed.setTimestamp(Date.now());
                    botStatusEmbed.setFooter({
                        text: localization(Available_Languages['pt-br'], 'embed|footer', [
                            { replace: '$version$', value: config.VERSION },
                            { replace: '$year$', value: new Date().getFullYear().toString() }
                        ])
                    });

                    await rest.patch(
                        Routes.channelMessage(
                            config.BOT_STATUS_CHANNEL_ID.channel_id,
                            config.BOT_STATUS_MESSAGE_ID.msg_id
                        ),
                        {
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: {
                                embeds: [botStatusEmbed.toJSON()]
                            }
                        }
                    );
                } catch (err) {
                    logger.logText('ERROR', err);
                }
            }
        }
    }
}

const botStatus = new BotStatus();

if (process.env.NODE_ENV !== 'test' && config.INSTANCE_TYPE === 'primary') {
    botStatus.enable();
}

export default botStatus;
