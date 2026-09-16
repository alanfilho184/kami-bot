const { InteractionResponseType } = require('discord-interactions');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

const appModule = require('../../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const {
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../../helpers/interaction-factory');

const mockRest = rest;
const mockDb = db;

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/sheets_list', () => {
    it('lista as fichas do usuario em embed', async () => {
        mockDb.sheets.findMany.mockResolvedValue([{ sheet_name: 'Guerreiro' }, { sheet_name: 'Mago' }]);

        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'sheets_list' }));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0].description).toContain('Guerreiro');
        expect(body.embeds[0].description).toContain('Mago');
    });

    it('sem fichas responde mensagem padrao', async () => {
        mockDb.sheets.findMany.mockResolvedValue([]);

        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'sheets_list' }));

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });
});
