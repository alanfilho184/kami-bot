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
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../../helpers/interaction-factory');

const mockRest = rest;
const mockDb = db;
const OWNER_ID = process.env.OWNER_ID;
const NON_OWNER_ID = '999999999999999999';

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/answer (owner-only)', () => {
    it('owner envia DM e confirma', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'answer',
                userId: OWNER_ID,
                options: [
                    { name: 'user_id', type: 3, value: '888888888888888888' },
                    { name: 'message', type: 3, value: 'Olá, aqui é o suporte!' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        // cria canal DM + envia mensagem
        expect(mockRest.post).toHaveBeenCalledWith(
            '/users/@me/channels',
            expect.objectContaining({ body: expect.objectContaining({ recipient_id: '888888888888888888' }) })
        );
        expect(mockRest.post).toHaveBeenCalledTimes(2);
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('nao-owner recebe owner-only sem enviar DM', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'answer',
                userId: NON_OWNER_ID,
                options: [
                    { name: 'user_id', type: 3, value: '888888888888888888' },
                    { name: 'message', type: 3, value: 'Oi' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);
        expect(mockRest.post).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });
});
