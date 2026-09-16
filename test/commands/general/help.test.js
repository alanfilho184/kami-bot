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

describe('/help', () => {
    it('responde embed + select menu de comandos', async () => {
        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'help' }));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0]).toEqual(expect.objectContaining({ title: 'Ajuda Kami' }));
        // 1 action row de botoes + 1 de select menu ($a$help-select-menu|...)
        expect(body.components).toHaveLength(2);
        const select = body.components[1].components[0];
        expect(select.custom_id).toEqual(expect.stringContaining('$a$help-select-menu|'));
    });
});
