const { InteractionResponseType } = require('discord-interactions');
const { Routes } = require('discord-api-types/v10');

const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../../helpers/interaction-factory');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

const appModule = require('../../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const {
    fakeUserRow,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');

const mockRest = rest;
const mockDb = db;

const APPLICATION_ID = process.env.CLIENT_ID;

const fakeUser = fakeUserRow();

beforeAll(async () => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);

    mockDb.users.findUnique.mockResolvedValue(fakeUser);
    mockDb.users.create.mockResolvedValue(fakeUser);
    mockDb.users.update.mockResolvedValue(fakeUser);

    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/roll', () => {
    it('rola 1d20: acknowledge deferred + reply via webhook + log de comando', async () => {
        const interaction = buildCommandInteraction({
            name: 'roll',
            options: [{ name: 'dice', type: 3, value: '20' }]
        });

        const res = await postCommandAndWaitReply(app, interaction);

        // 1) A resposta HTTP é o acknowledge (deferred), não a reply
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
            data: {}
        });

        // 2) A reply real saiu pelo webhook do Discord (rest mockado)
        expect(mockRest.patch).toHaveBeenCalledTimes(1);
        expect(mockRest.patch).toHaveBeenCalledWith(
            Routes.webhookMessage(APPLICATION_ID, interaction.token, '@original'),
            expect.objectContaining({ body: expect.any(Object) })
        );
        // Builders (Embed/ActionRow) guardam campos em `.data` — normaliza via toJSON.
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({
                embeds: [
                    expect.objectContaining({
                        title: expect.any(String),
                        color: expect.any(Number)
                    })
                ],
                components: [
                    expect.objectContaining({
                        type: 1,
                        components: [expect.objectContaining({ custom_id: 'roll-again|1d20' })]
                    })
                ]
            })
        );

        // 3) A estatística do comando foi persistida
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    action_type: 'COMMAND',
                    action_target: 'roll',
                    user_id: fakeUser.id,
                    status: 'SUCCESS',
                    source_system: 'INTERACTION_API'
                })
            })
        );
    });

    it('normaliza "20" para "1d20" no botão roll-again', async () => {
        const interaction = buildCommandInteraction({
            name: 'roll',
            options: [{ name: 'dice', type: 3, value: '6' }]
        });

        await postCommandAndWaitReply(app, interaction);

        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({
                components: [
                    expect.objectContaining({
                        type: 1,
                        components: [expect.objectContaining({ custom_id: 'roll-again|1d6' })]
                    })
                ]
            })
        );
    });

    it('responde com mensagem de erro para dado inválido (sem throw)', async () => {
        const interaction = buildCommandInteraction({
            name: 'roll',
            options: [{ name: 'dice', type: 3, value: 'abc' }]
        });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        expect(mockRest.patch).toHaveBeenLastCalledWith(
            Routes.webhookMessage(APPLICATION_ID, interaction.token, '@original'),
            expect.objectContaining({
                body: expect.objectContaining({ content: expect.any(String) })
            })
        );
    });
});
