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

describe('/buttonroll', () => {
    it('cria botoes para dados validos separados por |', async () => {
        const interaction = buildCommandInteraction({
            name: 'buttonroll',
            options: [{ name: 'dices', type: 3, value: '1d20 | 2d6' }]
        });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        // 2 dados => 1 action row com 2 botoes buttonRoll|<dado>
        expect(body.components).toHaveLength(1);
        const buttons = body.components[0].components;
        expect(buttons).toHaveLength(2);
        expect(buttons[0]).toEqual(expect.objectContaining({ custom_id: 'buttonRoll|1d20' }));
        expect(buttons[1]).toEqual(expect.objectContaining({ custom_id: 'buttonRoll|2d6' }));
    });

    it('rejeita mais de 25 dados', async () => {
        const tooMany = Array.from({ length: 26 }, () => '1d6').join('|');
        const interaction = buildCommandInteraction({
            name: 'buttonroll',
            options: [{ name: 'dices', type: 3, value: tooMany }]
        });

        await postCommandAndWaitReply(app, interaction);

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('lista os dados invalidos na resposta', async () => {
        const interaction = buildCommandInteraction({
            name: 'buttonroll',
            options: [{ name: 'dices', type: 3, value: '1d20 | abc' }]
        });

        await postCommandAndWaitReply(app, interaction);

        const body = lastWebhookBody(mockRest);
        expect(body.content).toEqual(expect.stringContaining('abc'));
    });
});
