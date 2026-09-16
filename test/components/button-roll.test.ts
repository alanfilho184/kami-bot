import { InteractionResponseType } from 'discord-interactions';

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
import { buildComponentInteraction, postCommandAndWaitReply, waitAppReady } from '../helpers/interaction-factory';

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

describe('Componente buttonRoll', () => {
    it('buttonRoll|2d6 rola o dado do botao', async () => {
        const interaction = buildComponentInteraction({ componentId: 'buttonRoll|2d6' });

        const res = await postCommandAndWaitReply(app, interaction);

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.embeds[0]).toEqual(expect.objectContaining({ title: expect.any(String) }));
    });
});
