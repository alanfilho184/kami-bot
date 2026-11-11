const sensitiveKeys =
    /senha|password|passwd|pwd|token|secret|authorization|cookie|sessao|session|csrf|api[_-]?key|credential|cpf|cnpj|discord_?id|webhook_url|x-kami-service-token/i;
const sensitiveOptionName =
    /senha|password|passwd|pwd|code|codigo|token|secret|auth|api[_-]?key|credential|cpf|cnpj|email/i;
const credentialUrl = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^:\s]+:)[^@\s]+@/gi;
const bearerToken = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi;
const keyValueSecret =
    /\b(senha|password|passwd|pwd|token|secret|api[_-]?key|code|codigo|authorization)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const discordWebhookToken = /(https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/)[A-Za-z0-9._-]+/gi;
const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const MAX_DEPTH = 6;

export function maskEmails(text: string): string {
    return text.replace(emailPattern, match => {
        const at = match.indexOf('@');
        return `${match.slice(0, 1)}***@${match.slice(at + 1)}`;
    });
}

function redactText(text: string): string {
    return maskEmails(
        text
            .replace(credentialUrl, '$1***@')
            .replace(discordWebhookToken, '$1***')
            .replace(bearerToken, '$1 ***')
            .replace(keyValueSecret, (_match, key: string) => `${key}=***`)
    );
}

export function redactTextValue(text: string): string {
    return redactText(text);
}

export function isSensitiveOptionName(name: string): boolean {
    return sensitiveOptionName.test(name);
}

function redactValue(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) {
        return '[limit]';
    }

    if (typeof value === 'string') {
        return redactText(value);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Buffer.isBuffer(value)) {
        return `[buffer: ${value.byteLength} bytes]`;
    }

    if (value instanceof Error) {
        const code = (value as NodeJS.ErrnoException).code;

        return {
            name: value.name,
            message: redactText(value.message),
            stack: value.stack ? redactText(value.stack) : undefined,
            code: code === undefined ? undefined : redactText(String(code))
        };
    }

    if (Array.isArray(value)) {
        return value.map(item => redactValue(item, depth + 1));
    }

    if (value && typeof value === 'object') {
        const output: Record<string, unknown> = {};

        for (const [key, content] of Object.entries(value as Record<string, unknown>)) {
            output[key] = sensitiveKeys.test(key) ? '***' : redactValue(content, depth + 1);
        }

        return output;
    }

    return value;
}

export function redactContext(context: unknown): unknown {
    return redactValue(context);
}

export function redactDiscordOptions(
    options: Array<{ name: string; value: unknown; options?: unknown }> | undefined
): Array<{ name: string; value: unknown }> | undefined {
    if (!options) {
        return undefined;
    }

    return options.map(option => {
        const nested = Array.isArray((option as { options?: unknown }).options)
            ? redactDiscordOptions((option as { options: Array<{ name: string; value: unknown }> }).options)
            : undefined;

        return {
            ...option,
            ...(nested ? { options: nested } : {}),
            value: isSensitiveOptionName(option.name) ? '***' : option.value
        };
    });
}
