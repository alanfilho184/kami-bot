const {
    buildDiscordPayload,
    buildTextPayload,
    getRedactedDiscordDetails,
    normalizeError
} = require('../../src/logs/payload');

const base = {
    release: '5.4.0',
    instance: 'primary',
    instance_role: 'primary'
};

const request = {
    request_id: 'req-1',
    method: 'POST',
    route: '/interactions',
    ip: '127.0.0.1',
    user_id: 1
};

function buildCommand(overrides = {}) {
    return {
        id: '123',
        type: 2,
        data: {
            name: 'roll',
            options: []
        },
        component: undefined,
        guild_id: '333333333333333333',
        guild_locale: 'pt-BR',
        channel_id: '444444444444444444',
        channel: { id: '444444444444444444', type: 0, name: 'geral' },
        language: 'pt-br',
        kami_user: { id: 7 },
        user: { id: '222222222222222222', global_name: 'Tester' },
        createdTimestamp: 1,
        version: 1,
        ...overrides
    };
}

describe('logs/payload', () => {
    it('monta log-texto achatado com contexto e automatico', () => {
        const result = buildTextPayload({
            level: 'WARN',
            message: 'DNS switch',
            automated: true,
            context: {
                event: 'failover.dns.switch',
                action: 'takeover',
                dns_changed: true
            },
            base,
            request,
            time: '2026-11-09T12:00:00.000Z'
        });

        expect(result.payload).toMatchObject({
            time: '2026-11-09T12:00:00.000Z',
            nivel: 'WARN',
            mensagem: 'DNS switch',
            automatico: true,
            event: 'failover.dns.switch',
            action: 'takeover',
            dns_changed: true,
            request_id: 'req-1',
            method: 'POST',
            route: '/interactions',
            ip: '127.0.0.1',
            user_id: 1,
            release: '5.4.0',
            instance: 'primary',
            instance_role: 'primary'
        });
    });

    it('normaliza Error e adiciona error_name/error_code', () => {
        const error = Object.assign(new Error('falhou'), { code: 'ECONNREFUSED' });
        const result = buildTextPayload({
            level: 'ERROR',
            message: error,
            automated: false,
            base,
            time: '2026-11-09T12:00:00.000Z'
        });

        expect(result.payload).toMatchObject({
            mensagem: 'falhou',
            error_name: 'Error',
            error_code: 'ECONNREFUSED',
            error: {
                name: 'Error',
                message: 'falhou',
                code: 'ECONNREFUSED'
            }
        });
        expect(normalizeError(error)).toMatchObject({ name: 'Error', message: 'falhou' });
    });

    it('monta comando com execution_ms e redige senha', () => {
        const int = buildCommand({
            data: {
                name: 'ficha_configurar_senha',
                options: [
                    { name: 'nova_senha_da_ficha', value: 'segredo' },
                    { name: 'nome_da_ficha', value: 'Ficha' }
                ]
            }
        });
        const payload = buildDiscordPayload({
            int,
            base,
            request,
            event: 'discord.command',
            execution_ms: 123,
            time: '2026-11-09T12:00:00.000Z'
        });

        expect(payload).toMatchObject({
            nivel: 'INFO',
            event: 'discord.command',
            action: 'ficha_configurar_senha',
            command: 'ficha_configurar_senha',
            user_id: 7,
            execution_ms: 123,
            request_id: 'req-1',
            route: '/interactions'
        });
        expect(payload.args).toBe('nova_senha_da_ficha: ***, nome_da_ficha: Ficha');
        expect(payload).not.toHaveProperty('data');
        expect(payload).not.toHaveProperty('token');
        expect(JSON.stringify(payload)).not.toContain('segredo');
    });

    it('usa WARN para failed/rejected', () => {
        const int = buildCommand();
        const failed = buildDiscordPayload({
            int,
            base,
            event: 'discord.command.failed',
            execution_ms: 5,
            time: '2026-11-09T12:00:00.000Z'
        });
        const rejected = buildDiscordPayload({
            int,
            base,
            event: 'discord.command.rejected',
            execution_ms: 0,
            time: '2026-11-09T12:00:00.000Z'
        });

        expect(failed.nivel).toBe('WARN');
        expect(rejected.nivel).toBe('WARN');
    });

    it('remove token e senha dos dados locais redigidos', () => {
        const int = buildCommand({
            data: {
                name: 'ficha_configurar_senha',
                options: [{ name: 'nova_senha_da_ficha', value: 'segredo' }]
            }
        });
        const details = getRedactedDiscordDetails(int);

        expect(details.args).toBe('nova_senha_da_ficha: ***');
        expect(JSON.stringify(details.data)).not.toContain('segredo');
    });
});
