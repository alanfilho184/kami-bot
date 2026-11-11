import type { LogContext } from './types';

export interface ResolvedLogOptions {
    sendToRemote: boolean;
    notifyDiscord: boolean;
    context: LogContext;
}

/**
 * Resolve as opções de controle do log:
 * - `remote: false` => somente console (sem webhook e sem kami-logger)
 * - `notifyDiscord: true` => força o webhook para eventos operacionais
 */
export function resolveLogOptions(context?: LogContext): ResolvedLogOptions {
    if (!context) {
        return {
            sendToRemote: true,
            notifyDiscord: false,
            context: {}
        };
    }

    const { remote, notifyDiscord, ...data } = context;

    return {
        sendToRemote: remote !== false,
        notifyDiscord: notifyDiscord === true,
        context: data
    };
}
