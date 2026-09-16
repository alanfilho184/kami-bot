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
const OWNER_ID = process.env.OWNER_ID!;
const NON_OWNER_ID = '999999999999999999';

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/reloadslashs (owner-only)', () => {
    it('owner recarrega comandos globais + da guilda', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'reloadslashs', userId: OWNER_ID })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(mockRest.get).toHaveBeenCalled();
        expect(mockRest.put).toHaveBeenCalledTimes(2);
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: 'Comandos recarregados' }));
    });

    it('nao-owner recebe owner-only', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'reloadslashs', userId: NON_OWNER_ID })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.flags).toBe(InteractionResponseFlags.EPHEMERAL);
        expect(mockRest.put).not.toHaveBeenCalled();
    });

    it('falha no put global responde erro sem throw', async () => {
        mockRest.put.mockRejectedValueOnce(new Error('discord fora do ar'));

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'reloadslashs', userId: OWNER_ID })
        );

        expect(res.status).toBe(200);
        expect(mockRest.put).toHaveBeenCalledTimes(1);
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: 'Erro ao recarregar os comandos' })
        );
    });

    it('falha no put da guilda responde erro sem throw', async () => {
        mockRest.put.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('discord fora do ar'));

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'reloadslashs', userId: OWNER_ID })
        );

        expect(res.status).toBe(200);
        expect(mockRest.put).toHaveBeenCalledTimes(2);
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: 'Erro ao recarregar os comandos ownerOnly' })
        );
    });
});
