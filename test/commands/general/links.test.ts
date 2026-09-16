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

describe('/links', () => {
    it('responde embed + 5 botoes de link', async () => {
        const res = await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'links' }));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);

        const body = lastWebhookBody(mockRest);
        expect(body.embeds).toHaveLength(1);
        expect(body.components).toHaveLength(1);
        expect(body.components[0].components).toHaveLength(5);
    });
});
