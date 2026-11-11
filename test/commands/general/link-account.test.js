const { InteractionResponseFlags, InteractionResponseType } = require('discord-interactions');

jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

const appModule = require('../../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const config = require('../../../src/configs/config').default;
const { lastWebhookBody, setupDefaultDbMocks, setupDefaultRestMocks } = require('../../helpers/mock-factories');
const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../../helpers/interaction-factory');

const mockRest = rest;
const mockDb = db;
const originalFetch = global.fetch;
const originalToken = config.BOT_SYNC_TOKEN;

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
    config.BOT_SYNC_TOKEN = 'test-bot-sync-token';
    global.fetch = jest.fn();
});

afterEach(() => {
    global.fetch = originalFetch;
    config.BOT_SYNC_TOKEN = originalToken;
});

describe('/vincular', () => {
    it('confirma o código no site e mostra o username', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ siteUsername: 'Lyra' })
        });

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account',
                options: [{ name: 'code', type: 3, value: 'ABCD-1234' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(res.body.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);
        expect(global.fetch).toHaveBeenCalledWith(
            'https://kamiapp.com.br/api/internal/discord/claim',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'x-kami-service-token': 'test-bot-sync-token'
                }),
                body: JSON.stringify({
                    code: 'ABCD-1234',
                    discordId: '222222222222222222',
                    discordUsername: 'tester'
                })
            })
        );
        expect(lastWebhookBody(mockRest).content).toContain('Lyra');
    });

    it('aceita o nome pt-br do argumento "codigo"', async () => {
        global.fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ siteUsername: 'Lyra' })
        });

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account',
                options: [{ name: 'codigo', type: 3, value: 'ABCD-1234' }]
            })
        );

        expect(global.fetch).toHaveBeenCalled();
        expect(lastWebhookBody(mockRest).content).toContain('Lyra');
    });

    it('informa código inválido quando o site recusa', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            json: async () => ({ code: 'discord_code_invalid' })
        });

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account',
                options: [{ name: 'code', type: 3, value: 'INVALIDO' }]
            })
        );

        expect(lastWebhookBody(mockRest).content).toContain('Código inválido');
    });

    it('informa indisponibilidade em erro inesperado do site', async () => {
        global.fetch.mockResolvedValue({
            ok: false,
            json: async () => ({ code: 'unexpected' })
        });

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account',
                options: [{ name: 'code', type: 3, value: 'ABCD-1234' }]
            })
        );

        expect(lastWebhookBody(mockRest).content).toContain('Não foi possível validar');
    });

    it('informa indisponibilidade quando o fetch lança', async () => {
        global.fetch.mockRejectedValue(new Error('site fora'));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account',
                options: [{ name: 'code', type: 3, value: 'ABCD-1234' }]
            })
        );

        expect(lastWebhookBody(mockRest).content).toContain('Não foi possível validar');
    });

    it('recusa quando o token de serviço não está configurado', async () => {
        config.BOT_SYNC_TOKEN = '';

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account',
                options: [{ name: 'code', type: 3, value: 'ABCD-1234' }]
            })
        );

        expect(global.fetch).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest).content).toContain('Não foi possível validar');
    });

    it('recusa quando o código não foi informado', async () => {
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'link_account'
            })
        );

        expect(global.fetch).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest).content).toContain('Código inválido');
    });
});
