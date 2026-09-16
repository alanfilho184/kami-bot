const { InteractionResponseType } = require('discord-interactions');

const { buildPingInteraction, postSignedInteraction, waitAppReady } = require('../helpers/interaction-factory');

// Mocks em test/mocks/{rest,database}.ts (com factory:
// evita o erro de variáveis out-of-scope no hoist do jest.mock).
jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
jest.mock('../../src/configs/database', () => require('../mocks/database'));

const appModule = require('../../src/app');
const app = appModule.default;
const { ready } = appModule;
const db = require('../../src/configs/database').default;
const { fakeUserRow, setupDefaultDbMocks, setupDefaultRestMocks } = require('../helpers/mock-factories');
const rest = require('../../src/configs/rest').default;

const mockDb = db;
const mockRest = rest;

beforeAll(async () => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
    mockDb.users.findUnique.mockResolvedValue(fakeUserRow());
    mockDb.users.update.mockResolvedValue(fakeUserRow());
    await waitAppReady();
    await ready;
});

describe('PING (HTTP puro, sem chamada externa)', () => {
    it('responde PONG para interação assinada', async () => {
        const interaction = buildPingInteraction();

        const res = await postSignedInteraction(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ type: InteractionResponseType.PONG });
    });
});
