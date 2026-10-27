const { CloudflareDns } = require('../../src/modules/cloudflare-dns');

const originalFetch = globalThis.fetch;

function makeResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
        json: async () => body
    };
}

function envelope(result) {
    return { success: true, result, errors: [] };
}

function makeDns(overrides = {}) {
    return new CloudflareDns({
        apiToken: 'test-token',
        zoneId: 'test-zone',
        recordName: 'bot.url.com.br',
        ttl: 60,
        targets: {
            primary: {
                type: 'CNAME',
                content: 'bot-primary.url.com.br',
                proxied: true
            },
            secondary: {
                type: 'CNAME',
                content: 'bot-secondary.url.com.br',
                proxied: true
            },
            backup: {
                type: 'CNAME',
                content: 'bot-backup.url.com.br',
                proxied: true
            }
        },
        ...overrides
    });
}

const primaryRecord = {
    id: 'record-1',
    type: 'CNAME',
    name: 'bot.url.com.br',
    content: 'bot-primary.url.com.br',
    proxied: true,
    ttl: 1
};

const secondaryRecord = {
    id: 'record-2',
    type: 'CNAME',
    name: 'bot.url.com.br',
    content: 'bot-secondary.url.com.br',
    proxied: true,
    ttl: 1
};

const backupRecord = {
    id: 'record-3',
    type: 'CNAME',
    name: 'bot.url.com.br',
    content: 'bot-backup.url.com.br',
    proxied: true,
    ttl: 1
};

const aRecord = {
    id: 'record-a',
    type: 'A',
    name: 'bot.url.com.br',
    content: '203.0.113.10',
    proxied: false,
    ttl: 60
};

beforeEach(() => {
    globalThis.fetch = jest.fn();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('CloudflareDns', () => {
    it('não altera quando o registro já está no estado desejado', async () => {
        globalThis.fetch.mockResolvedValue(makeResponse(envelope([backupRecord])));

        const result = await makeDns().apply('backup');

        expect(result).toMatchObject({ ok: true, changed: false, action: 'noop' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch.mock.calls[0][1].method).toBe('GET');
    });

    it('faz PATCH de CNAME quando o conteúdo aponta para outro hostname', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(makeResponse(envelope([primaryRecord])))
            .mockResolvedValueOnce(makeResponse(envelope({ ...primaryRecord, content: 'bot-backup.url.com.br' })));

        const result = await makeDns().apply('backup');

        expect(result).toMatchObject({ ok: true, changed: true, action: 'patch' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);

        const [url, init] = globalThis.fetch.mock.calls[1];
        expect(url).toContain('/dns_records/record-1');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toMatchObject({
            content: 'bot-backup.url.com.br',
            proxied: true,
            ttl: 1
        });
    });

    it('faz PATCH de CNAME quando o alvo é o secondary', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(makeResponse(envelope([primaryRecord])))
            .mockResolvedValueOnce(makeResponse(envelope({ ...primaryRecord, content: 'bot-secondary.url.com.br' })));

        const result = await makeDns().apply('secondary');

        expect(result).toMatchObject({ ok: true, changed: true, action: 'patch' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);

        const [url, init] = globalThis.fetch.mock.calls[1];
        expect(url).toContain('/dns_records/record-1');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toMatchObject({
            content: 'bot-secondary.url.com.br',
            proxied: true,
            ttl: 1
        });
    });

    it('cria o registro quando não existe nenhum conflitante', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(makeResponse(envelope([])))
            .mockResolvedValueOnce(makeResponse(envelope({ ...primaryRecord, id: 'record-new' })));

        const result = await makeDns().apply('primary');

        expect(result).toMatchObject({ ok: true, changed: true, action: 'create' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);

        const [url, init] = globalThis.fetch.mock.calls[1];
        expect(url).toContain('/dns_records');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toMatchObject({
            type: 'CNAME',
            name: 'bot.url.com.br',
            content: 'bot-primary.url.com.br',
            proxied: true,
            ttl: 1
        });
    });

    it('não altera nada em dry-run', async () => {
        globalThis.fetch.mockResolvedValue(makeResponse(envelope([primaryRecord])));

        const result = await makeDns().apply('backup', { dryRun: true });

        expect(result).toMatchObject({ ok: true, changed: true, action: 'patch' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('recria o registro quando o tipo muda (A -> CNAME)', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(makeResponse(envelope([aRecord])))
            .mockResolvedValueOnce(makeResponse(envelope({ id: aRecord.id })))
            .mockResolvedValueOnce(makeResponse(envelope({ ...backupRecord, id: 'record-cname' })));

        const dns = makeDns({
            targets: {
                primary: { type: 'A', content: '203.0.113.10', proxied: false },
                secondary: { type: 'CNAME', content: 'bot-secondary.url.com.br', proxied: true },
                backup: { type: 'CNAME', content: 'bot-backup.url.com.br', proxied: true }
            }
        });

        const result = await dns.apply('backup');

        expect(result).toMatchObject({ ok: true, changed: true, action: 'recreate' });
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
        expect(globalThis.fetch.mock.calls[1][0]).toContain('/dns_records/record-a');
        expect(globalThis.fetch.mock.calls[1][1].method).toBe('DELETE');
        expect(JSON.parse(globalThis.fetch.mock.calls[2][1].body)).toMatchObject({
            type: 'CNAME',
            name: 'bot.url.com.br',
            content: 'bot-backup.url.com.br',
            proxied: true,
            ttl: 1
        });
    });

    it('restaura o estado anterior quando a criação falha', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(makeResponse(envelope([aRecord])))
            .mockResolvedValueOnce(makeResponse(envelope({ id: aRecord.id })))
            .mockResolvedValueOnce(
                makeResponse({ success: false, result: null, errors: [{ code: 1004, message: 'invalid record' }] }, 400)
            )
            .mockResolvedValueOnce(makeResponse(envelope([])))
            .mockResolvedValueOnce(makeResponse(envelope({ ...aRecord, id: 'record-a-restored' })));

        const dns = makeDns({
            targets: {
                primary: { type: 'A', content: '203.0.113.10', proxied: false },
                secondary: { type: 'CNAME', content: 'bot-secondary.url.com.br', proxied: true },
                backup: { type: 'CNAME', content: 'bot-backup.url.com.br', proxied: true }
            }
        });

        const result = await dns.apply('backup');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('rollback');
        expect(globalThis.fetch).toHaveBeenCalledTimes(5);
        expect(JSON.parse(globalThis.fetch.mock.calls[4][1].body)).toMatchObject({
            type: 'A',
            name: 'bot.url.com.br',
            content: '203.0.113.10',
            proxied: false,
            ttl: 60
        });
    });

    it('trata success:false mesmo com HTTP 200', async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse({ success: false, result: null, errors: [{ code: 1004, message: 'bad request' }] }, 200)
        );

        const result = await makeDns().apply('backup');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('bad request');
    });

    it('não retenta erros 4xx', async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse(
                { success: false, result: null, errors: [{ code: 10000, message: 'Authentication error' }] },
                401
            )
        );

        const result = await makeDns().apply('backup');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Authentication error');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('retenta erros 5xx', async () => {
        jest.useFakeTimers();

        try {
            globalThis.fetch
                .mockResolvedValueOnce(
                    makeResponse(
                        { success: false, result: null, errors: [{ code: 500, message: 'server error' }] },
                        500
                    )
                )
                .mockResolvedValueOnce(makeResponse(envelope([backupRecord])));

            const promise = makeDns().apply('backup');
            await jest.advanceTimersByTimeAsync(2000);
            const result = await promise;

            expect(result).toMatchObject({ ok: true, changed: false, action: 'noop' });
            expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('considera CNAME equivalente sem diferenciar caixa/ponto final', async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse(envelope([{ ...backupRecord, content: 'BOT-BACKUP.url.com.br.' }]))
        );

        const result = await makeDns().apply('backup');

        expect(result.action).toBe('noop');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it('detecta configuração incompleta', () => {
        expect(makeDns().isConfigured).toBe(true);

        const dns = makeDns({
            targets: {
                primary: { type: 'CNAME', content: '', proxied: true },
                secondary: { type: 'CNAME', content: 'bot-secondary.url.com.br', proxied: true },
                backup: { type: 'CNAME', content: 'bot-backup.url.com.br', proxied: true }
            }
        });

        expect(dns.isConfigured).toBe(false);
    });

    it('aceita o modelo de 2 hosts sem o alvo de backup', () => {
        const dns = makeDns({
            targets: {
                primary: { type: 'CNAME', content: 'bot-primary.url.com.br', proxied: true },
                secondary: { type: 'CNAME', content: 'bot-secondary.url.com.br', proxied: true }
            }
        });

        expect(dns.isConfigured).toBe(true);
        expect(dns.hasTarget('primary')).toBe(true);
        expect(dns.hasTarget('secondary')).toBe(true);
        expect(dns.hasTarget('backup')).toBe(false);
    });

    it('identifica o papel ativo pelo registro atual', async () => {
        globalThis.fetch.mockResolvedValue(makeResponse(envelope([secondaryRecord])));

        await expect(makeDns().getCurrentTarget()).resolves.toBe('secondary');
    });

    it('respeita a ordem primary > secondary > backup ao identificar o alvo', async () => {
        globalThis.fetch
            .mockResolvedValueOnce(makeResponse(envelope([backupRecord])))
            .mockResolvedValueOnce(makeResponse(envelope([secondaryRecord, backupRecord])))
            .mockResolvedValueOnce(makeResponse(envelope([primaryRecord, secondaryRecord, backupRecord])));

        const dns = makeDns();

        await expect(dns.getCurrentTarget()).resolves.toBe('backup');
        await expect(dns.getCurrentTarget()).resolves.toBe('secondary');
        await expect(dns.getCurrentTarget()).resolves.toBe('primary');
    });

    it('retorna null quando o registro não corresponde a nenhum alvo', async () => {
        globalThis.fetch.mockResolvedValue(
            makeResponse(envelope([{ ...primaryRecord, content: 'outro.url.com.br' }]))
        );

        await expect(makeDns().getCurrentTarget()).resolves.toBeNull();
    });

    it('recusa aplicar um alvo que não está configurado', async () => {
        const dns = makeDns({
            targets: {
                primary: { type: 'CNAME', content: 'bot-primary.url.com.br', proxied: true },
                secondary: { type: 'CNAME', content: 'bot-secondary.url.com.br', proxied: true }
            }
        });

        const result = await dns.apply('backup');

        expect(result).toMatchObject({ ok: false, changed: false, action: 'noop' });
        expect(result.error).toContain('Unknown DNS target');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });
});
