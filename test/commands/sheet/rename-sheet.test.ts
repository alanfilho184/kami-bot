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
    setupDefaultRestMocks
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

describe('/rename_sheet', () => {
    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'rename_sheet',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Inexistente' },
                    { name: 'new_sheet_name', type: 3, value: 'Nova' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });

    it('mesmo nome responde same-name', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'rename_sheet',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'new_sheet_name', type: 3, value: 'Test Sheet' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('nome ja usado responde already-exists', async () => {
        mockDb.sheets.findFirst
            .mockResolvedValueOnce(sheetWithSection())
            .mockResolvedValueOnce(sheetWithSection({ id: 99, sheet_name: 'Existente' }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'rename_sheet',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'new_sheet_name', type: 3, value: 'Existente' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Existente') })
        );
    });

    it('caso valido pede confirmacao com botoes', async () => {
        mockDb.sheets.findFirst.mockResolvedValueOnce(sheetWithSection()).mockResolvedValueOnce(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'rename_sheet',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'new_sheet_name', type: 3, value: 'Novo Nome' }
                ]
            })
        );

        const body = lastWebhookBody(mockRest);
        expect(body.content).toEqual(expect.stringContaining('Novo Nome'));
        expect(JSON.stringify(body.components)).toContain('$a$confirm-rename-sheet|');
    });
});

describe('/rename_sheet confirmacao ($a$)', () => {
    const promptRename = async () => {
        mockDb.sheets.findFirst.mockResolvedValueOnce(sheetWithSection()).mockResolvedValueOnce(null);
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'rename_sheet',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'new_sheet_name', type: 3, value: 'Novo Nome' }
                ]
            })
        );
        return lastWebhookBody(mockRest);
    };

    it('confirmar renomeia e sincroniza', async () => {
        const confirmId = findActionId(await promptRename(), '$a$confirm-rename-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ sheet_name: 'Novo Nome' }) })
        );
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Novo Nome') })
        );
    });

    it('cancelar desabilita os botoes', async () => {
        const cancelId = findActionId(await promptRename(), '$a$cancel-rename-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
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
                name: 'rename_sheet',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});
