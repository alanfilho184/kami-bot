import { InteractionResponseType } from 'discord-interactions';

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

import app, { ready } from '../../../src/app';
import rest from '../../../src/configs/rest';
import db from '../../../src/configs/database';
import sheetNameCache from '../../../src/resources/cache/sheet-name.cache';
import {
    MockDb,
    MockRest,
    fakeSheetRow,
    findActionId,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks,
    waitForCall
} from '../../helpers/mock-factories';
import {
    buildAutocompleteInteraction,
    buildCommandInteraction,
    buildComponentInteraction,
    postCommandAndWaitReply,
    postSignedInteraction,
    waitAppReady
} from '../../helpers/interaction-factory';

const mockRest = rest as unknown as MockRest;
const mockDb = db as unknown as MockDb;

const sheetWithSection = (overrides: Record<string, unknown> = {}) =>
    fakeSheetRow({
        id: 10,
        user_id: 1,
        sheet_name: 'Test Sheet',
        attributes: {
            sections: [
                {
                    name: 'Atributos',
                    position: 0,
                    type: 0,
                    attributes: [{ name: 'Força', value: '10', position: 0, type: 0 }]
                }
            ]
        },
        ...overrides
    });

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/delete_sheet', () => {
    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'delete_sheet',
                options: [{ name: 'sheet_name', type: 3, value: 'Inexistente' }]
            })
        );

        expect(res.status).toBe(200);
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });

    it('caso valido pede confirmacao com botoes', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'delete_sheet',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        const body = lastWebhookBody(mockRest);
        expect(body.content).toEqual(expect.stringContaining('Test Sheet'));
        expect(JSON.stringify(body.components)).toContain('$a$confirm-delete-sheet|');
    });
});

describe('/delete_sheet confirmacao ($a$)', () => {
    const promptDelete = async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'delete_sheet',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );
        return lastWebhookBody(mockRest);
    };

    it('confirmar apaga a ficha', async () => {
        const confirmId = findActionId(await promptDelete(), '$a$confirm-delete-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.delete).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ id: 10 }) })
        );
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('confirmar apaga mensagens sincronizadas (irt)', async () => {
        mockDb.irt_sheets.findMany.mockResolvedValue([
            { id: 7, sheet_id: 10, user_id: 1, msg_id: '111111111111111111', channel_id: '222222222222222222' }
        ]);
        const confirmId = findActionId(await promptDelete(), '$a$confirm-delete-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        // delete roda em paralelo ao patch de confirmação — espera determinística
        await waitForCall(mockRest.delete);
        expect(mockRest.delete).toHaveBeenCalledWith(
            expect.stringContaining('/channels/222222222222222222/messages/111111111111111111')
        );
        await waitForCall(mockDb.irt_sheets.deleteMany);
        expect(mockDb.irt_sheets.deleteMany).toHaveBeenCalled();
    }, 20000);

    it('cancelar desabilita os botoes', async () => {
        const cancelId = findActionId(await promptDelete(), '$a$cancel-delete-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(mockDb.sheets.delete).not.toHaveBeenCalled();
        const body = lastWebhookBody(mockRest);
        for (const button of body.components[0].components) {
            expect(button.disabled).toBe(true);
        }
    });

    it('autocomplete de sheet_name sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'delete_sheet',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});
