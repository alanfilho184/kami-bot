import { DateTime } from 'luxon';
import { inspect } from 'node:util';
import color from 'colors';
import { EmbedBuilder } from '@discordjs/builders';
import { InteractionType } from 'discord-interactions';

import commands from '../commands';
import components from '../components';
import config from '../configs/config';
import type { Interaction } from '../resources/utils/interaction-handler';
import { sendCommandWebhook, sendLogWebhook } from './discord-logger';
import { createLoggerClient } from './client';
import { getRequestLogContext, setRequestUserId } from './context';
import {
    buildDiscordPayload,
    buildTextPayload,
    getRedactedDiscordDetails,
    normalizeError,
    type BaseLogContext,
    type NormalizedError
} from './payload';
import { redactContext, redactTextValue } from './redact';
import { resolveLogOptions } from './options';
import type { DiscordLogOptions, IngestEventName, LogContext, LogLevel, LoggerClient } from './types';

export interface LogHandlerOptions {
    createClient?: typeof createLoggerClient;
}

export default class Logger {
    private remote: LoggerClient | null = null;
    private remoteConnectedLogged = false;
    private lastRemoteErrorAt = 0;
    private readonly createClient: typeof createLoggerClient;

    constructor(options: LogHandlerOptions = {}) {
        this.createClient = options.createClient ?? createLoggerClient;

        process.on('uncaughtException', err => {
            this.logText('ERROR', err, true);
        });

        process.on('unhandledRejection', err => {
            this.logText('ERROR', err, true);
        });

        this.initializeRemote();
    }

    public logText(level: LogLevel, message: unknown, automated: boolean = false, context?: LogContext): void {
        try {
            this.logTextInternal(level, message, automated, context);
        } catch (err) {
            // O logger nunca pode derrubar o fluxo do bot, mas uma falha no
            // próprio logger não pode desaparecer sem nenhum sinal.
            try {
                const message = err instanceof Error ? err.message : String(err);
                console.error('[logger] failed to register event', redactTextValue(message));
            } catch {
                // ignora falha do fallback
            }
        }
    }

    private logTextInternal(level: LogLevel, message: unknown, automated: boolean = false, context?: LogContext): void {
        const messageError = normalizeError(message);
        const options = resolveLogOptions(context);

        this.printConsole(level, message, messageError);

        // WARN continua indo para o webhook (DNS switch, avisos operacionais).
        // ERROR de aplicação fica só no kami-logger quando ele está habilitado.
        // Eventos operacionais (takeover/handback/DNS) pedem o webhook via
        // notifyDiscord; sem o logger, o webhook antigo continua como fallback.
        // remote: false desliga webhook e kami-logger (só console).
        const remoteAvailable = Boolean(this.remote?.isConnected());
        const shouldNotifyDiscord =
            options.sendToRemote &&
            (level === 'WARN' || (level === 'ERROR' && (options.notifyDiscord || !remoteAvailable)));

        if (shouldNotifyDiscord) {
            const display =
                messageError ??
                (options.context.error !== undefined ? { message: message, error: options.context.error } : message);
            const text = typeof display === 'object' ? inspect(display, false, 99) : `${display}`;
            const description = redactTextValue(text).slice(0, 3900);

            sendLogWebhook(
                new EmbedBuilder()
                    .setTitle(level)
                    .setDescription('```js\n' + description + '```')
                    .addFields({
                        name: 'Automatizado: ',
                        value: automated ? 'Sim' : 'Não',
                        inline: true
                    })
                    .setColor(parseInt(config.EMBED_COLOR))
                    .setFooter({
                        text: `Registrado em: ${DateTime.now()
                            .setZone('America/Sao_Paulo')
                            .toFormat('dd/MM/y | HH:mm:ss ')} (GMT -3)`
                    }),
                level === 'ERROR'
            ).catch(() => undefined);
        }

        if (!options.sendToRemote) {
            return;
        }

        const result = buildTextPayload({
            level,
            message,
            automated,
            context: options.context,
            base: this.baseContext(),
            request: getRequestLogContext(),
            time: new Date().toISOString()
        });

        this.sendRemote('log-texto', result.payload);
    }

    public info(message: unknown, context?: LogContext): void {
        this.logText('INFO', message, false, context);
    }

    public warn(message: unknown, context?: LogContext): void {
        this.logText('WARN', message, false, context);
    }

    public error(message: unknown, context?: LogContext): void {
        this.logText('ERROR', message, false, context);
    }

    public logTexto(level: LogLevel, message: unknown, context?: LogContext): void {
        this.logText(level, message, false, context);
    }

    public setUserId(userId: number | null): void {
        setRequestUserId(userId);
    }

    public async logDiscord(int: Interaction): Promise<void> {
        const executionDate = DateTime.fromMillis(int.createdTimestamp).setZone('America/Fortaleza');
        const details = getRedactedDiscordDetails(int);

        let type = '';
        let cmd = '';
        let language = '';

        if (int.type == InteractionType.APPLICATION_COMMAND) {
            type = 'Comando';
            cmd = int.data.name;
            language = int.language;

            if (!commands.get(cmd)) {
                this.logText('WARN', `Comando não encontrado: ${cmd}`, false, {
                    event: 'discord.command.unknown',
                    action: cmd
                });
            }
        } else if (int.type == InteractionType.MESSAGE_COMPONENT) {
            type = 'Componente';
            cmd = int.component!.name;
            language = int.language;

            if (!components.get(cmd)) {
                this.logText('WARN', `Componente não encontrado: ${cmd}`, false, {
                    event: 'discord.component.unknown',
                    action: cmd
                });
            }
        }

        console.log(
            `[ ${color.green(
                executionDate.toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS)
            )} ] - [ ${color.green('DISCORD')} ]\n${inspect(
                {
                    user: `${int.user.global_name} - ${int.user.id}`,
                    interaction_type: type,
                    cmd: cmd,
                    args: details.args,
                    language: language
                },
                false,
                99
            )}\n---------------------------\n`
        );

        const intLogEmbed = new EmbedBuilder()
            .setTitle(type + ': ' + '`' + cmd + '`')
            .setAuthor({
                name: `${int.user.global_name} - ${int.user.id}`,
                iconURL: `https://cdn.discordapp.com/avatars/${int.user.id}/${int.user.avatar}`
            })
            .setDescription('**Args:**\n' + '`' + details.args.slice(0, 4000) + '`')
            .addFields({ name: 'Idioma: ', value: '`' + language + '`', inline: true })
            .setFooter({
                text: 'Executado em: ' + executionDate.toFormat('dd/MM/y | HH:mm:ss ') + '(GMT -3)'
            })
            .setColor(parseInt(config.EMBED_COLOR));

        if (int.inGuild()) {
            intLogEmbed.addFields([
                {
                    name: 'Servidor: ',
                    value: '`' + int.guild_id + '`',
                    inline: true
                },
                {
                    name: 'Canal: ',
                    value: '`' + int.channel_id + '`' + ' - ' + '`' + (int.channel?.name ?? '') + '`'
                }
            ]);
        } else {
            intLogEmbed.addFields([
                {
                    name: 'Local: ',
                    value: '`' + 'DM' + '`',
                    inline: true
                }
            ]);
        }

        sendCommandWebhook(intLogEmbed).catch(() => undefined);
    }

    public logInteractionResult(int: Interaction, options: DiscordLogOptions): void {
        if (options.remote === false) {
            return;
        }

        try {
            const payload = buildDiscordPayload({
                int,
                base: this.baseContext(),
                request: getRequestLogContext(),
                event: options.event,
                execution_ms: options.execution_ms,
                error: options.error,
                time: new Date().toISOString()
            });

            this.sendRemote('log-texto', payload);
        } catch (err) {
            try {
                this.writeConsole('ERROR', 'Falha ao registrar resultado da interação', { error: err });
            } catch {
                // o log nunca pode derrubar a resposta da interação
            }
        }
    }

    public async flush(): Promise<void> {
        await this.remote?.flush();
    }

    public async close(): Promise<void> {
        const remote = this.remote;
        this.remote = null;

        if (remote) {
            await remote.close();
        }
    }

    private baseContext(): BaseLogContext {
        return {
            release: config.VERSION,
            instance: config.INSTANCE_NAME,
            instance_role: config.INSTANCE_TYPE
        };
    }

    private initializeRemote(): void {
        const url = config.LOGGER_URL;
        const token = config.LOGGER_TOKEN;

        if (!url && !token) {
            return;
        }

        if (!url || !token) {
            this.writeConsole(
                'WARN',
                'LOGGER_URL e LOGGER_TOKEN devem ser definidos juntos; envio remoto desabilitado',
                {
                    event: 'logger.remote.disabled'
                }
            );
            return;
        }

        if (!token.startsWith('klp_')) {
            this.writeConsole('WARN', 'LOGGER_TOKEN inválido; envio remoto desabilitado', {
                event: 'logger.remote.disabled'
            });
            return;
        }

        try {
            new URL(url);
        } catch {
            this.writeConsole('WARN', 'LOGGER_URL inválida; envio remoto desabilitado', {
                event: 'logger.remote.disabled'
            });
            return;
        }

        try {
            this.remote = this.createClient({
                url,
                token,
                instance: config.INSTANCE_NAME,
                onError: error => this.handleRemoteError(error),
                onConnect: () => {
                    if (this.remoteConnectedLogged) {
                        return;
                    }

                    this.remoteConnectedLogged = true;
                    this.writeConsole('INFO', 'Logger remoto conectado', {
                        event: 'logger.remote.connected'
                    });
                }
            });
        } catch (err) {
            this.writeConsole('WARN', `Falha ao criar o cliente do logger remoto: ${this.errorText(err)}`, {
                event: 'logger.remote.disabled'
            });
        }
    }

    private handleRemoteError(error: Error): void {
        const now = Date.now();

        if (now - this.lastRemoteErrorAt < 60_000) {
            return;
        }

        this.lastRemoteErrorAt = now;
        this.writeConsole('WARN', 'Logger remoto indisponível', { error });
    }

    private sendRemote(event: IngestEventName, payload: Record<string, unknown>): void {
        if (!this.remote) {
            return;
        }

        try {
            this.remote.send(event, payload);
        } catch (err) {
            this.handleRemoteError(err instanceof Error ? err : new Error(String(err)));
        }
    }

    private writeConsole(level: LogLevel, message: unknown, context?: LogContext): void {
        const messageError = normalizeError(message) ?? normalizeError(context?.error);
        this.printConsole(level, message, messageError);
    }

    private printConsole(level: LogLevel, message: unknown, normalizedError?: NormalizedError | null): void {
        const display = normalizedError ?? message;
        const safeDisplay = typeof display === 'object' ? redactContext(display) : redactTextValue(String(display));
        const colorMethod = level === 'INFO' ? color.green : level === 'WARN' ? color.yellow : color.red;
        const text = `[ ${color.green(
            DateTime.now().setZone('America/Fortaleza').toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS)
        )} ] - [ ${colorMethod(level)} ]\n${
            typeof safeDisplay === 'object' ? inspect(safeDisplay, false, 99) : safeDisplay
        }\n---------------------------\n`;

        if (level === 'ERROR') {
            console.error(text);
        } else if (level === 'WARN') {
            console.warn(text);
        } else {
            console.log(text);
        }
    }

    private errorText(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
