import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
jest.mock('../../src/configs/database', () => require('../mocks/database'));

import app, { ready } from '../../src/app';
import rest from '../../src/configs/rest';
import db from '../../src/configs/database';
import {
    MockDb,
    MockRest,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} from '../helpers/mock-factories';
import {
    buildCommandInteraction,
    buildComponentInteraction,
    postCommandAndWaitReply,
    postSignedInteraction,
    sign,
    waitAppReady
} from '../helpers/interaction-factory';

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

describe('Rota POST /interactions', () => {
    it('responde "command not found" para comando não registrado', async () => {
        const interaction = buildCommandInteraction({ name: 'nonexistent' });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        // acknowledge(true) => flag ephemeral presente
        expect(res.body.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('responde "command not found" para componente desconhecido', async () => {
        const interaction = buildComponentInteraction({ componentId: 'nope|1d20' });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('funciona em DM (sem guild_id)', async () => {
        const interaction = buildCommandInteraction({
            name: 'roll',
            options: [{ name: 'dice', type: 3, value: '10' }],
            inDM: true
        });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toEqual([expect.any(Object)]);
        expect(body.components).toEqual([expect.any(Object)]);
    });

    it('retorna 401 quando o corpo é adulterado após a assinatura', async () => {
        const interaction = buildCommandInteraction({
            name: 'roll',
            options: [{ name: 'dice', type: 3, value: '20' }]
        });

        const body = JSON.stringify(interaction);
        const timestamp = '1738000000';
        const signature = sign(body, timestamp);

        const tampered = {
            ...interaction,
            data: { ...interaction.data, name: 'help' }
        };

        // 401 responde direto (sem reply) — sem espera.
        const res = await postSignedInteraction(app, tampered, { signature, timestamp });

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Bad request signature' });
    });
});
