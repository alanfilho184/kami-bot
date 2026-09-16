const { InteractionResponseType } = require('discord-interactions');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
jest.mock('../../src/configs/database', () => require('../mocks/database'));

const appModule = require('../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../src/configs/rest').default;
const db = require('../../src/configs/database').default;
const {
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../helpers/mock-factories');
const { buildComponentInteraction, postCommandAndWaitReply, waitAppReady } = require('../helpers/interaction-factory');

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

describe('Componente roll-again', () => {
    it('roll-again|1d20 rola o dado novamente via comando roll', async () => {
        const interaction = buildComponentInteraction({ componentId: 'roll-again|1d20' });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0]).toEqual(expect.objectContaining({ title: expect.any(String) }));
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_type: 'COMPONENT', status: 'SUCCESS' })
            })
        );
    });
});
