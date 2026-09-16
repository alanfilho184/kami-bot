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
    fakeSheetRow,
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

describe('/sheet_configure_access', () => {
    it('torna a ficha publica', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(fakeSheetRow({ id: 10, user_id: 1 }));

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_access',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'visibility', type: 3, value: 'public' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(mockDb.sheets.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ is_public: true }) })
        );
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_access',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Inexistente' },
                    { name: 'visibility', type: 3, value: 'private' }
                ]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });

    it('sem visibilidade responde invalid-args', async () => {
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_access',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('visibilidade private torna a ficha privada', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(fakeSheetRow({ id: 10, user_id: 1 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_access',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'visibility', type: 3, value: 'private' }
                ]
            })
        );

        expect(mockDb.sheets.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ is_public: false }) })
        );
    });

    it('aceita nomes de opcao em pt-br', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(fakeSheetRow({ id: 10, user_id: 1 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_access',
                options: [
                    { name: 'nome_da_ficha', type: 3, value: 'Test Sheet' },
                    { name: 'visibilidade', type: 3, value: 'public' }
                ]
            })
        );

        expect(mockDb.sheets.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ is_public: true }) })
        );
    });
});
