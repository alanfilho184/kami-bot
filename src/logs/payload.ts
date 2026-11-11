import { InteractionType } from 'discord-interactions';
import type { Interaction } from '../resources/utils/interaction-handler';
import { redactContext, redactDiscordOptions, redactTextValue } from './redact';
import type { LogContext, LogLevel, RequestLogContext } from './types';

export interface BaseLogContext {
    release: string;
    instance: string;
    instance_role: string;
}

export interface NormalizedError {
    name: string;
    message: string;
    stack?: string;
    code?: string;
}

export interface RedactedDiscordDetails {
    data: Record<string, unknown> | undefined;
    component: Record<string, unknown> | undefined;
    args: string;
}

export interface TextPayloadInput {
    level: LogLevel;
    message: unknown;
    automated: boolean;
    context?: LogContext;
    base: BaseLogContext;
    request?: RequestLogContext;
    time: string;
}

export interface TextPayloadResult {
    payload: Record<string, unknown>;
    message: string;
    error: NormalizedError | null;
}

export interface DiscordPayloadInput {
    int: Interaction;
    base: BaseLogContext;
    request?: RequestLogContext;
    event: string;
    execution_ms: number | null;
    error?: unknown;
    time: string;
}

function stringify(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }

    try {
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : json;
    } catch {
        return String(value);
    }
}

export function normalizeError(value: unknown): NormalizedError | null {
    if (!value) {
        return null;
    }

    if (value instanceof Error) {
        const code = (value as NodeJS.ErrnoException).code;

        return {
            name: value.name,
            message: value.message,
            ...(value.stack ? { stack: value.stack } : {}),
            ...(code === undefined ? {} : { code: String(code) })
        };
    }

    if (typeof value === 'object') {
        const candidate = value as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };

        if (typeof candidate.message === 'string') {
            return {
                name: typeof candidate.name === 'string' ? candidate.name : 'Error',
                message: candidate.message,
                ...(typeof candidate.stack === 'string' ? { stack: candidate.stack } : {}),
                ...(candidate.code === undefined ? {} : { code: String(candidate.code) })
            };
        }
    }

    return null;
}

export function getRedactedDiscordDetails(int: Interaction): RedactedDiscordDetails {
    const redactedOptions = int.data?.options
        ? redactDiscordOptions(int.data.options as Array<{ name: string; value: unknown }>)
        : undefined;
    const options = redactedOptions?.map(option => ({
        ...option,
        value: typeof option.value === 'string' && option.value !== '***' ? redactTextValue(option.value) : option.value
    }));
    const data = int.data ? ({ ...int.data, ...(options ? { options } : {}) } as Record<string, unknown>) : undefined;
    const component = int.component
        ? ({
              ...int.component,
              args: redactTextValue(int.component.args ?? '')
          } as Record<string, unknown>)
        : undefined;
    const args =
        options && options.length > 0
            ? options.map(option => `${option.name}: ${String(option.value)}`).join(', ')
            : component?.args
              ? String(component.args)
              : 'Sem argumentos';

    return { data, component, args };
}

export function buildTextPayload(input: TextPayloadInput): TextPayloadResult {
    const messageError = normalizeError(input.message);
    const contextError = normalizeError(input.context?.error);
    const normalizedError = messageError ?? contextError;
    const messageText = messageError
        ? messageError.message
        : typeof input.message === 'string'
          ? input.message
          : stringify(input.message);
    const context = input.context ?? {};
    const automatic = input.automated || context.automatic === true || context.automatico === true;

    const payload: Record<string, unknown> = {
        ...input.base,
        ...(input.request ?? {}),
        ...context,
        time: input.time,
        nivel: input.level,
        mensagem: messageText,
        automatico: automatic
    };

    if (normalizedError) {
        payload.error = normalizedError;
        payload.error_name = normalizedError.name;
        payload.error_code = normalizedError.code;
    }

    const redacted = redactContext(payload) as Record<string, unknown>;

    return {
        payload: redacted,
        message: redactTextValue(messageText),
        error: normalizedError
    };
}

export function buildDiscordPayload(input: DiscordPayloadInput): Record<string, unknown> {
    const command = input.int.type === InteractionType.APPLICATION_COMMAND ? input.int.data?.name : undefined;
    const component = input.int.type === InteractionType.MESSAGE_COMPONENT ? input.int.component?.name : undefined;
    const action = command ?? component;
    const message = command ? `Comando: ${command}` : component ? `Componente: ${component}` : 'Interação';
    const details = getRedactedDiscordDetails(input.int);
    const normalizedError = normalizeError(input.error);
    const level: LogLevel = input.event.endsWith('.failed') || input.event.endsWith('.rejected') ? 'WARN' : 'INFO';

    const payload: Record<string, unknown> = {
        ...input.base,
        ...(input.request ?? {}),
        time: input.time,
        nivel: level,
        mensagem: message,
        event: input.event,
        action,
        command,
        component,
        interaction_id: input.int.id,
        interaction_type: input.int.type,
        guild_id: input.int.guild_id ?? null,
        channel_id: input.int.channel_id ?? null,
        language: input.int.language,
        user_id: input.int.kami_user?.id ?? input.request?.user_id ?? null,
        execution_ms: input.execution_ms,
        args: details.args,
        ...(normalizedError
            ? {
                  error: normalizedError,
                  error_name: normalizedError.name,
                  error_code: normalizedError.code
              }
            : {})
    };

    return redactContext(payload) as Record<string, unknown>;
}
