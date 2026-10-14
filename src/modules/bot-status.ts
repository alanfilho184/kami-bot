import { DateTime } from 'luxon';
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
import { renderStatusImage, STATUS_IMAGE_EXTENSION, STATUS_IMAGE_MIME } from '../resources/utils/status-image';
import metrics from '../resources/utils/metrics';
import { measureClockOffset as probeClockOffset } from '../resources/utils/clock-offset';
import { performance } from 'node:perf_hooks';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class BotStatus {
    statusMessageId: string | null = null;
    statusChannelId: string | null = null;
    dbData: any = null;
    discordData: any = null;
    private timers: NodeJS.Timeout[] = [];
    private enabled: boolean = false;
    private updating: boolean = false;

    // Só existe status quando a instância está no controle: primária sempre,
    // backup apenas depois de assumir (failover) - ver modules/take-over.ts
    get isRunningOnBackup(): boolean {
        return config.INSTANCE_TYPE === 'backup';
    }

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

        void this.measureClockOffset();
        this.timers.push(
            setInterval(() => {
                void this.measureClockOffset();
            }, ms('10m'))
        );

        void this.getDiscordData();
        this.timers.push(
            setInterval(() => {
                void this.getDiscordData();
            }, ms('10m'))
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
        const fortaleza = 'America/Fortaleza';
        const nowFt = DateTime.now().setZone(fortaleza);
        const todayStartUtc = nowFt.startOf('day').toUTC();
        const yesterdayStartUtc = todayStartUtc.minus({ days: 1 });
        // Momento do dia em ms desde a meia-noite. Corta o dia anterior no mesmo
        // ponto para a variação diária comparar "hoje até agora" com "ontem até
        // a mesma hora", e não com o dia inteiro. Fortaleza é UTC-3 fixo (sem
        // horário de verão desde 2012), então não há degrau a considerar.
        const elapsedTodayMs = nowFt.diff(nowFt.startOf('day'), 'milliseconds').milliseconds;
        const yesterdayCutoffUtc = yesterdayStartUtc.plus({ milliseconds: elapsedTodayMs });
        const weekStartUtc = nowFt.startOf('week').toUTC();
        const weekPrevStartUtc = weekStartUtc.minus({ weeks: 1 });
        const weekEndUtc = weekStartUtc.plus({ weeks: 1 });
        const monthStartUtc = nowFt.startOf('month').toUTC();
        const prevMonthStartUtc = nowFt.startOf('month').minus({ months: 1 }).toUTC();

        const fmt = (dt: DateTime) => dt.toFormat('yyyy-MM-dd HH:mm:ss.SSS');
        const T_TODAY = fmt(todayStartUtc);
        const T_YESTERDAY = fmt(yesterdayStartUtc);
        const T_YESTERDAY_CUTOFF = fmt(yesterdayCutoffUtc);
        const T_WEEK_START = fmt(weekStartUtc);
        const T_WEEK_PREV_START = fmt(weekPrevStartUtc);
        const T_WEEK_END = fmt(weekEndUtc);
        const T_MONTH_START = fmt(monthStartUtc);
        const T_PREV_MONTH_START = fmt(prevMonthStartUtc);
        const T_RETENTION = fmt(prevMonthStartUtc);

        let pingStart = Date.now();
        const data = (
            (await db.$queryRawUnsafe(`
                WITH 
                    log_metrics AS (
                        SELECT
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' AND timestamp >= '${T_TODAY}'::timestamp THEN 1 
                                END) AS total_commands_24h,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' AND timestamp >= '${T_TODAY}'::timestamp THEN 1 
                                END) AS total_components_24h,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND'
                                AND timestamp >= '${T_YESTERDAY}'::timestamp
                                AND timestamp < '${T_TODAY}'::timestamp THEN 1
                                END) AS total_commands_prev_24h,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT'
                                AND timestamp >= '${T_YESTERDAY}'::timestamp
                                AND timestamp < '${T_TODAY}'::timestamp THEN 1
                                END) AS total_components_prev_24h,

                            -- dia anterior cortado no mesmo horário de hoje, usado
                            -- só na variação diária; a linha ONTEM do painel
                            -- continua usando o dia inteiro acima
                            COUNT(CASE
                                WHEN action_type = 'COMMAND'
                                AND timestamp >= '${T_YESTERDAY}'::timestamp
                                AND timestamp < '${T_YESTERDAY_CUTOFF}'::timestamp THEN 1
                                END) AS total_commands_prev_day_to_date,
                            COUNT(CASE
                                WHEN action_type = 'COMPONENT'
                                AND timestamp >= '${T_YESTERDAY}'::timestamp
                                AND timestamp < '${T_YESTERDAY_CUTOFF}'::timestamp THEN 1
                                END) AS total_components_prev_day_to_date,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' AND timestamp >= '${T_WEEK_START}'::timestamp THEN 1 
                                END) AS total_commands_7d,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' AND timestamp >= '${T_WEEK_START}'::timestamp THEN 1 
                                END) AS total_components_7d,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND'
                                AND timestamp >= '${T_WEEK_PREV_START}'::timestamp
                                AND timestamp < '${T_WEEK_START}'::timestamp THEN 1
                                END) AS total_commands_prev_7d,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT'
                                AND timestamp >= '${T_WEEK_PREV_START}'::timestamp
                                AND timestamp < '${T_WEEK_START}'::timestamp THEN 1
                                END) AS total_components_prev_7d,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' AND timestamp >= '${T_MONTH_START}'::timestamp THEN 1 
                                END) AS total_commands_30d,
                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' AND timestamp >= '${T_MONTH_START}'::timestamp THEN 1 
                                END) AS total_components_30d,
                            COUNT(CASE 
                                WHEN action_type = 'COMMAND' 
                                AND timestamp >= '${T_PREV_MONTH_START}'::timestamp
                                AND timestamp < '${T_MONTH_START}'::timestamp
                                THEN 1 
                                END) AS total_commands_prev_month,

                            COUNT(CASE 
                                WHEN action_type = 'COMPONENT' 
                                AND timestamp >= '${T_PREV_MONTH_START}'::timestamp
                                AND timestamp < '${T_MONTH_START}'::timestamp
                                THEN 1 
                                END) AS total_components_prev_month

                        FROM
                            logs
                        WHERE
                            timestamp >= '${T_RETENTION}'::timestamp
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
                    ),
                    daily_days AS (
                        SELECT
                            ((timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'America/Fortaleza')::date AS day,
                            COUNT(*) AS total
                        FROM
                            logs
                        WHERE
                            timestamp >= '${T_PREV_MONTH_START}'::timestamp
                            AND timestamp < '${T_WEEK_END}'::timestamp
                        GROUP BY
                            1
                    )

                    SELECT
                        (SELECT COUNT(id) FROM users) AS total_users,
                        (SELECT COUNT(id) FROM users WHERE last_use >= NOW() - INTERVAL '30 days') AS total_active_users,
                        (SELECT COUNT(id) FROM sheets) AS total_sheets_created,

                        t.total_commands AS total_commands,
                        t.total_components AS total_components,
                        l.total_commands_24h AS total_commands_today,
                        l.total_components_24h AS total_components_today,
                        l.total_commands_prev_24h AS total_commands_prev_day,
                        l.total_components_prev_24h AS total_components_prev_day,
                        l.total_commands_prev_day_to_date AS total_commands_prev_day_to_date,
                        l.total_components_prev_day_to_date AS total_components_prev_day_to_date,
                        l.total_commands_7d AS total_commands_week,
                        l.total_components_7d AS total_components_week,
                        l.total_commands_prev_7d AS total_commands_prev_week,
                        l.total_components_prev_7d AS total_components_prev_week,
                        l.total_commands_30d AS total_commands_month,
                        l.total_components_30d AS total_components_month,
                        
                        l.total_commands_prev_month AS total_commands_prev_month,
                        l.total_components_prev_month AS total_components_prev_month,

                        (SELECT COALESCE(json_agg(json_build_object('day', day, 'total', total) ORDER BY day), '[]'::json)
                         FROM daily_days) AS daily_usage
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
                total_commands_prev_day: number;
                total_components_prev_day: number;
                total_commands_prev_day_to_date: number;
                total_components_prev_day_to_date: number;
                total_commands_week: number;
                total_components_week: number;
                total_commands_prev_week: number;
                total_components_prev_week: number;
                total_commands_month: number;
                total_components_month: number;
                total_commands_prev_month: number;
                total_components_prev_month: number;
                daily_usage: { day: string; total: number }[] | string;
            }[]
        )[0];
        let pingEnd = Date.now();

        let dailyUsage: { day: string; total: number }[] = [];
        const rawDailyUsage = data?.daily_usage;
        if (Array.isArray(rawDailyUsage)) {
            dailyUsage = rawDailyUsage as { day: string; total: number }[];
        } else if (typeof rawDailyUsage === 'string') {
            try {
                const parsed = JSON.parse(rawDailyUsage);
                if (Array.isArray(parsed)) dailyUsage = parsed;
            } catch {
                dailyUsage = [];
            }
        }

        this.dbData = {
            totalUsers: Number(data.total_users),
            totalActiveUsers: Number(data.total_active_users),
            totalSheetsCreated: Number(data.total_sheets_created),
            totalCommands: Number(data.total_commands) + 803_410, //O BOT antigo só mantinha contagem simples de comandos
            totalComponents: Number(data.total_components) + 120_647, //O BOT antigo só mantinha contagem simples de componentes
            totalCommandsToday: Number(data.total_commands_today),
            totalComponentsToday: Number(data.total_components_today),
            totalCommandsPrevDay: Number(data.total_commands_prev_day),
            totalComponentsPrevDay: Number(data.total_components_prev_day),
            totalCommandsPrevDayToDate: Number(data.total_commands_prev_day_to_date),
            totalComponentsPrevDayToDate: Number(data.total_components_prev_day_to_date),
            totalCommandsWeek: Number(data.total_commands_week),
            totalComponentsWeek: Number(data.total_components_week),
            totalCommandsPrevWeek: Number(data.total_commands_prev_week),
            totalComponentsPrevWeek: Number(data.total_components_prev_week),
            totalCommandsMonth: Number(data.total_commands_month),
            totalComponentsMonth: Number(data.total_components_month),
            totalCommandsPrevMonth: Number(data.total_commands_prev_month),
            totalComponentsPrevMonth: Number(data.total_components_prev_month),
            dailyUsage: dailyUsage,
            dbPing: pingEnd - pingStart
        };
    }

    /**
     * Dados da aplicação (servidores, instalações) + latência de ida e volta
     * até a borda do Discord, medida na mesma rota.
     *
     * Uma amostra isolada mistura DNS, handshake TLS, reuso de keep-alive e
     * ruído de event loop, então tiramos algumas amostras e ficamos com a
     * mediana - `performance.now()` é monotônico e não sofre com degrau de NTP.
     * A primeira amostra é a chamada que já precisava acontecer para bring os
     * contadores, o resto é preenchido com chamadas extras à mesma rota.
     */
    async getDiscordData(samples: number = 2): Promise<void> {
        const times: number[] = [];

        try {
            const startedAt = performance.now();
            const applicationPartial = (await rest.get(Routes.currentApplication())) as {
                approximate_guild_count: number;
                approximate_user_install_count: number;
                approximate_user_authorization_count: number;
            };
            times.push(performance.now() - startedAt);

            for (let i = 1; i < samples; i++) {
                await sleep(1000);
                const extraStartedAt = performance.now();
                try {
                    await rest.get(Routes.currentApplication());
                    times.push(performance.now() - extraStartedAt);
                } catch {
                    // ignora a amostra: chamada falhou
                }
            }

            times.sort((a, b) => a - b);

            this.discordData = {
                ...(this.discordData ?? {}),
                approximateGuildCount: applicationPartial.approximate_guild_count,
                approximateUserInstallCount: applicationPartial.approximate_user_install_count,
                approximateUserAuthorizationCount: applicationPartial.approximate_user_authorization_count,
                apiLatency: times.length > 0 ? times[Math.floor(times.length / 2)] : 0
            };
        } catch (err) {
            logger.logText('ERROR', err);
        }
    }

    private lastClockProbeAt = 0;

    /**
     * Mede o desvio do relógio do sistema e aplica na métrica de entrada.
     *
     * A sonda só LÊ o offset (w32tm no Windows; chrony/timedatectl/adjtimex
     * no Linux) — ela jamais ajusta o relógio. Se falhar, o card segue
     * mostrando o estado de dessincronia quando o delta bruto é implausível.
     */
    async measureClockOffset(): Promise<void> {
        if (process.env.CLOCK_OFFSET_ENABLED === 'false') return;
        if (this.lastClockProbeAt !== 0 && Date.now() - this.lastClockProbeAt < ms('5m')) return;
        this.lastClockProbeAt = Date.now();

        const result = await probeClockOffset();
        if (!result) return;

        metrics.setClockOffset(result.offsetMs, result.source);

        if (Math.abs(result.offsetMs) >= 10) {
            logger.logText(
                'INFO',
                `Relógio local com desvio de ${Math.round(result.offsetMs)} ms (fonte: ${result.source}). ` +
                    'O valor está sendo corrigido na métrica de latência de entrada.'
            );
        }
    }

    async buildStatusImage(): Promise<Buffer> {
        const uptime = process.uptime();
        const days = Math.floor((uptime % 31536000) / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const botuptime =
            (days > 0 ? (days == 1 ? days + ' dia ' : days + ' dias ') : '') +
            (hours > 0 ? (hours == 1 ? hours + ' hora ' : hours + ' horas ') : '') +
            (minutes > 0 ? (minutes == 1 ? minutes + ' minuto ' : minutes + ' minutos ') : '');

        const stats = this.getProcessStats();

        const totalInteractionsDay =
            Number(this.dbData?.totalCommandsToday || 0) + Number(this.dbData?.totalComponentsToday || 0);
        const totalInteractionsPrevDay =
            Number(this.dbData?.totalCommandsPrevDay || 0) + Number(this.dbData?.totalComponentsPrevDay || 0);
        // Ontem cortado no mesmo horário de hoje, para a variação não comparar
        // um dia parcial com o dia inteiro.
        const totalInteractionsPrevDayToDate =
            Number(this.dbData?.totalCommandsPrevDayToDate || 0) +
            Number(this.dbData?.totalComponentsPrevDayToDate || 0);
        const totalInteractionsWeek =
            Number(this.dbData?.totalCommandsWeek || 0) + Number(this.dbData?.totalComponentsWeek || 0);
        const totalInteractionsPrevWeek =
            Number(this.dbData?.totalCommandsPrevWeek || 0) + Number(this.dbData?.totalComponentsPrevWeek || 0);
        const totalInteractionsMonth =
            Number(this.dbData?.totalCommandsMonth || 0) + Number(this.dbData?.totalComponentsMonth || 0);
        const totalInteractionsPrevMonth =
            Number(this.dbData?.totalCommandsPrevMonth || 0) + Number(this.dbData?.totalComponentsPrevMonth || 0);

        const formatGrowth = (current: number, previous: number): string => {
            if (!previous) return 'N/A';
            const growth = ((current - previous) / previous) * 100;
            if (growth == 0) return `→ 0.00 %`;
            if (growth > 0) return `↑ ${growth.toFixed(2)} %`;
            return `↓ ${Math.abs(growth).toFixed(2)} %`;
        };

        const nowFt = DateTime.now().setZone('America/Fortaleza');
        const today = nowFt;
        const weekStart = nowFt.startOf('week');
        const weekLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
        const usageByDay = new Map<string, number>(
            (Array.isArray(this.dbData?.dailyUsage) ? this.dbData.dailyUsage : []).map((entry: any) => [
                String(entry?.day),
                Number(entry?.total || 0)
            ])
        );
        const weeklyUsage = weekLabels.map((label, index) => {
            const day = weekStart.plus({ days: index });
            const previousDay = day.minus({ weeks: 1 });
            return {
                label: label,
                total: usageByDay.get(day.toFormat('yyyy-MM-dd')) ?? 0,
                previous: usageByDay.get(previousDay.toFormat('yyyy-MM-dd')) ?? 0,
                isToday: day.hasSame(today, 'day')
            };
        });

        /**
         * Compara períodos equivalentes, nunca um trecho contra um período
         * inteiro:
         *
         * - diária: hoje até agora contra ontem até a MESMA hora;
         * - semanal: os N dias decorridos contra os N dias da semana passada;
         * - mensal: os N dias decorridos contra os N dias do mês passado.
         *
         * Sem isso a variação mede o tamanho da janela em vez da tendência, e
         * por isso aparece negativa quase sempre (1 dia contra 7, 1 contra 31).
         */
        // `diff` devolve fração de dia; o piso converte em "quantos dias já
        // ocorreram", e o +1 inclui o dia de hoje (que está pela metade).
        const elapsedDays = Math.floor(today.diff(weekStart, 'days').days) + 1;
        const sumDays = (start: DateTime, days: number): number => {
            let total = 0;
            for (let offset = 0; offset < days; offset++) {
                total += usageByDay.get(start.plus({ days: offset }).toFormat('yyyy-MM-dd')) ?? 0;
            }
            return total;
        };

        const monthStart = nowFt.startOf('month');
        const prevMonthStart = monthStart.minus({ months: 1 });
        // Se o mês corrente já passou do tamanho do anterior (31 de março contra
        // 28 de fevereiro), o recorte é limitado para comparar o mesmo número
        // de dias nos dois.
        const alignedMonthDays = Math.min(
            Math.floor(nowFt.diff(monthStart, 'days').days) + 1,
            prevMonthStart.daysInMonth ?? 31
        );

        const dailyGrowth = formatGrowth(totalInteractionsDay, totalInteractionsPrevDayToDate);
        const weeklyGrowth = formatGrowth(
            sumDays(weekStart, elapsedDays),
            sumDays(weekStart.minus({ weeks: 1 }), elapsedDays)
        );
        const monthlyGrowth = formatGrowth(
            sumDays(monthStart, alignedMonthDays),
            sumDays(prevMonthStart, alignedMonthDays)
        );

        // os-utils já devolve MB, então /1024 converte para GB
        const ramTotalGb = os.totalmem() / 1024;
        const ramUsedGb = os.totalmem() / 1024 - os.freemem() / 1024;
        const accentColor = Number(config.EMBED_COLOR);

        return renderStatusImage({
            cpu: Number(stats.cpu),
            memory: Number(stats.memory.toFixed(2)),
            ramUsedGb: Number(ramUsedGb.toFixed(1)),
            ramTotalGb: Number(ramTotalGb.toFixed(1)),
            restPing: Number(this.discordData?.apiLatency || 0),
            ingressLatency: metrics.ingress,
            clockOffsetMs: metrics.hasFreshClockOffset ? metrics.clockOffsetMs : null,
            cycleMs: Number(this.discordData?.cycleMs || 0),
            encodeMs: Number(this.discordData?.encodeMs || 0),
            uploadMs: Number(this.discordData?.uploadMs || 0),
            dbPing: Number(this.dbData?.dbPing || 0),
            uptime: botuptime,
            guildCount: Number(this.discordData?.approximateGuildCount || 0),
            userCount: Number(this.dbData?.totalUsers || 0),
            activeUsers: Number(this.dbData?.totalActiveUsers || 0),
            sheetsCreated: Number(this.dbData?.totalSheetsCreated || 0),
            interactions: [
                {
                    label: 'Hoje',
                    commands: Number(this.dbData?.totalCommandsToday || 0),
                    components: Number(this.dbData?.totalComponentsToday || 0),
                    total: totalInteractionsDay,
                    highlight: true
                },
                {
                    label: 'Ontem',
                    commands: Number(this.dbData?.totalCommandsPrevDay || 0),
                    components: Number(this.dbData?.totalComponentsPrevDay || 0),
                    total: totalInteractionsPrevDay
                },
                {
                    label: 'Esta Semana',
                    commands: Number(this.dbData?.totalCommandsWeek || 0),
                    components: Number(this.dbData?.totalComponentsWeek || 0),
                    total: totalInteractionsWeek,
                    highlight: true
                },
                {
                    label: 'Semana Passada',
                    commands: Number(this.dbData?.totalCommandsPrevWeek || 0),
                    components: Number(this.dbData?.totalComponentsPrevWeek || 0),
                    total: totalInteractionsPrevWeek
                },
                {
                    label: 'Este Mês',
                    commands: Number(this.dbData?.totalCommandsMonth || 0),
                    components: Number(this.dbData?.totalComponentsMonth || 0),
                    total: totalInteractionsMonth,
                    highlight: true
                },
                {
                    label: 'Mês Passado',
                    commands: Number(this.dbData?.totalCommandsPrevMonth || 0),
                    components: Number(this.dbData?.totalComponentsPrevMonth || 0),
                    total: totalInteractionsPrevMonth
                },
                {
                    label: 'Desde o início',
                    commands: Number(this.dbData?.totalCommands || 0),
                    components: Number(this.dbData?.totalComponents || 0),
                    total: Number(this.dbData?.totalCommands || 0) + Number(this.dbData?.totalComponents || 0)
                }
            ],
            dailyGrowth: dailyGrowth,
            weeklyGrowth: weeklyGrowth,
            monthlyGrowth: monthlyGrowth,
            weeklyUsage: weeklyUsage,
            version: config.VERSION,
            nodeVersion: process.version,
            accent:
                Number.isFinite(accentColor) && accentColor >= 0
                    ? '#' + (accentColor >>> 0).toString(16).padStart(6, '0').slice(-6)
                    : '#0082ff',
            banner: this.isRunningOnBackup
                ? {
                      text: 'MODO BACKUP ATIVO',
                      detail: 'O servidor primário está offline, o servidor de backup assumiu o controle.',
                      // severidade "warning" do design NERV
                      color: '#FF9900',
                      accent: '#FF9900'
                  }
                : null
        });
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
                if (this.updating) return;
                this.updating = true;

                try {
                    const isBackup = this.isRunningOnBackup;

                    const encodeStartedAt = performance.now();
                    const image = await this.buildStatusImage();
                    const encodeMs = performance.now() - encodeStartedAt;

                    // Nome único a cada ciclo para evitar cache antigo da CDN do Discord
                    const fileName = `kami-status-${Math.floor(Date.now() / 60000)}.${STATUS_IMAGE_EXTENSION}`;

                    const botStatusEmbed = new EmbedBuilder();
                    botStatusEmbed.setColor(isBackup ? 0xff9900 : Number(config.EMBED_COLOR));
                    botStatusEmbed.setTitle(isBackup ? 'Status do Kami BOT (Servidor Backup)' : 'Status do Kami BOT');
                    botStatusEmbed.setDescription(
                        isBackup
                            ? ':warning: **MODO BACKUP ATIVO**\nO servidor primário está offline, o servidor de backup assumiu o controle, o tempo de resposta do BOT pode ficar mais lento.'
                            : 'Monitoramento em tempo real do BOT e da comunidade.'
                    );
                    botStatusEmbed.setImage(`attachment://${fileName}`);
                    botStatusEmbed.setTimestamp(Date.now());
                    botStatusEmbed.setFooter({
                        text: localization(Available_Languages['pt-br'], 'embed|footer', [
                            { replace: '$version$', value: config.VERSION },
                            { replace: '$year$', value: new Date().getFullYear().toString() }
                        ])
                    });

                    const uploadStartedAt = performance.now();
                    await rest.patch(
                        Routes.channelMessage(
                            config.BOT_STATUS_CHANNEL_ID.channel_id,
                            config.BOT_STATUS_MESSAGE_ID.msg_id
                        ),
                        {
                            body: {
                                embeds: [botStatusEmbed.toJSON()],
                                files: [{ attachment: `attachment://${fileName}`, name: fileName }]
                            },
                            files: [
                                {
                                    name: fileName,
                                    data: image,
                                    contentType: STATUS_IMAGE_MIME
                                }
                            ]
                        }
                    );

                    const uploadMs = performance.now() - uploadStartedAt;
                    this.discordData = {
                        ...(this.discordData ?? {}),
                        encodeMs,
                        uploadMs,
                        cycleMs: encodeMs + uploadMs
                    };
                } catch (err) {
                    logger.logText('ERROR', err);
                } finally {
                    this.updating = false;
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
