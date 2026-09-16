const { InteractionResponseType } = require('discord-interactions');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));
// botinfo lê applicationInfo (fetch no import, desativado em teste) e
// botStatus.getProcessStats() (null em teste) — mocka os dois módulos.
jest.mock('../../../src/modules/bot-status', () => ({
    __esModule: true,
    default: { getProcessStats: () => ({ memory: 123.45, cpu: '1.23' }) }
}));
jest.mock('../../../src/resources/utils/application-info', () => ({
    __esModule: true,
    applicationInfo: { approximate_guild_count: 42 }
}));

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

describe('/botinfo', () => {
    it('responde embed de estatisticas', async () => {
        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'botinfo' }));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0]).toEqual(expect.objectContaining({ title: expect.any(String) }));
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_target: 'botinfo', status: 'SUCCESS' })
            })
        );
    });
});
