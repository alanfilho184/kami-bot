import { InteractionResponseType } from 'discord-interactions';

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

describe('/insanity', () => {
    it('insanidade temporaria responde embed', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'insanity',
                options: [{ name: 'type', type: 3, value: 'temporary' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0]).toEqual(expect.objectContaining({ title: expect.any(String) }));
        // Todas as ramificações do dado (1/2/3+) devem gerar descrição válida,
        // nunca "Localization error" (regressão: índices errados em positionRoll).
        expect(body.embeds[0].description).toEqual(expect.any(String));
        expect(body.embeds[0].description).not.toContain('Localization error');
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_target: 'insanity', status: 'SUCCESS' })
            })
        );
    });

    it('insanidade permanente responde embed', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'insanity',
                options: [{ name: 'type', type: 3, value: 'permanent' }]
            })
        );

        expect(res.status).toBe(200);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0]).toEqual(expect.objectContaining({ title: expect.any(String) }));
    });
});
