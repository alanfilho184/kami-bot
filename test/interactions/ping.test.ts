/// <reference types="jest" />

import { InteractionResponseType } from 'discord-interactions';

import { buildPingInteraction, postSignedInteraction, waitAppReady } from '../helpers/interaction-factory';

// Mocks em test/mocks/{rest,database}.ts (com factory:
// evita o erro de variáveis out-of-scope no hoist do jest.mock).
jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
jest.mock('../../src/configs/database', () => require('../mocks/database'));

import app, { ready } from '../../src/app';
import db from '../../src/configs/database';
import { MockDb, fakeUserRow, setupDefaultDbMocks, setupDefaultRestMocks } from '../helpers/mock-factories';
import rest from '../../src/configs/rest';

const mockDb = db as unknown as MockDb;
const mockRest = rest as unknown as { get: jest.Mock; post: jest.Mock; patch: jest.Mock };

beforeAll(async () => {
    setupDefaultRestMocks(mockRest as never);
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
