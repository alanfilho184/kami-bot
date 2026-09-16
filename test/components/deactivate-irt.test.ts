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

describe('Componente deactivate-irt', () => {
    it('dono desativa a mensagem sincronizada', async () => {
        mockDb.irt_sheets.findFirst.mockResolvedValue({
            id: 5,
            sheet_id: 10,
            user_id: 1,
            msg_id: '111111111111111111',
            channel_id: '222222222222222222'
        });

        const res = await postCommandAndWaitReply(
            app,
            buildComponentInteraction({ componentId: 'deactivate-irt|111111111111111111' })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(mockDb.irt_sheets.deleteMany).toHaveBeenCalled();
        expect(mockRest.patch).toHaveBeenCalledWith(
            expect.stringContaining('/channels/222222222222222222/messages/111111111111111111'),
            expect.anything()
        );
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });
});
