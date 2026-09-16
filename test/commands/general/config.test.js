const { InteractionResponseFlags, InteractionResponseType } = require('discord-interactions');

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
    findActionId,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const {
    buildCommandInteraction,
    buildComponentInteraction,
    postCommandAndWaitReply,
    waitAppReady
} = require('../../helpers/interaction-factory');

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

describe('/config', () => {
    it('responde embed efemero + botoes $a$config-toggle-*', async () => {
        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'config' }));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        // doNotAcknowledge + acknowledge(true) manual => ephemeral
        expect(res.body.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.components).toHaveLength(2);
        const flat = JSON.stringify(body.components);
        for (const id of [
            '$a$config-toggle-sec-gen|',
            '$a$config-toggle-sec-insan|',
            '$a$config-toggle-sec-roll|',
            '$a$config-toggle-sec-send|',
            '$a$config-toggle-sec-sheet|',
            '$a$config-toggle-lang|'
        ]) {
            expect(flat).toContain(id);
        }
    });

    it('mostra estado atual quando o usuario ja tem preferencias', async () => {
        mockDb.users.findUnique.mockResolvedValue(
            fakeUserRow({
                user_config: [
                    {
                        language: 'EN_US',
                        secret_general: true,
                        secret_insan: true,
                        secret_roll: true,
                        secret_send: true,
                        secret_sheet: true
                    }
                ]
            })
        );

        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'config' }));

        expect(res.status).toBe(200);
        expect(lastWebhookBody(mockRest).embeds).toHaveLength(1);
    });
});

describe('/config toggles ($a$)', () => {
    const toggles = [
        ['sec-gen', { secret_general: true }],
        ['sec-insan', { secret_insan: true }],
        ['sec-roll', { secret_roll: true }],
        ['sec-send', { secret_send: true }],
        ['sec-sheet', { secret_sheet: true }]
    ];

    it.each(toggles)('alterna %s e persiste', async (suffix, expectedUpdate) => {
        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'config' }));
        const actionId = findActionId(lastWebhookBody(mockRest), `$a$config-toggle-${suffix}|`);

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: actionId }));

        expect(mockDb.users_config.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: expect.objectContaining(expectedUpdate) })
        );
        // a mensagem é atualizada com o novo estado
        expect(lastWebhookBody(mockRest).embeds).toHaveLength(1);
    });

    it('alterna o idioma pt-br -> en-us e persiste', async () => {
        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'config' }));
        const actionId = findActionId(lastWebhookBody(mockRest), '$a$config-toggle-lang|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: actionId }));

        expect(mockDb.users_config.upsert).toHaveBeenCalledWith(
            // o comando passa 'en-us'; o controller grava no formato do banco (EN_US)
            expect.objectContaining({ update: expect.objectContaining({ language: 'EN_US' }) })
        );
    });
});
