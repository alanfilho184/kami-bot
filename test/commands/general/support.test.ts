import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

import app, { ready } from '../../../src/app';
import rest from '../../../src/configs/rest';
import db from '../../../src/configs/database';
import {
    MockDb,
    MockRest,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} from '../../helpers/mock-factories';
import { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } from '../../helpers/interaction-factory';

const mockRest = rest as unknown as MockRest;
const mockDb = db as unknown as MockDb;

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/support', () => {
    it('encaminha a mensagem ao canal de suporte e confirma', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'support',
                options: [{ name: 'message', type: 3, value: 'Preciso de ajuda!' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(res.body.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);

        // 1) post da mensagem no canal de log + pin
        expect(mockRest.post).toHaveBeenCalledWith(
            expect.stringContaining('/channels/'),
            expect.objectContaining({ body: expect.objectContaining({ embeds: [expect.any(Object)] }) })
        );
        expect(mockRest.put).toHaveBeenCalledTimes(1);

        // 2) confirmacao efemera ao usuario
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_target: 'support', status: 'SUCCESS' })
            })
        );
    });

    it('sem mensagem cai no handler de erro (FAILED + reply de erro)', async () => {
        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'support' }));

        expect(res.status).toBe(200);
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_target: 'support', status: 'FAILED' })
            })
        );
    });
});
