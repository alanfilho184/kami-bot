import { InteractionResponseType } from 'discord-interactions';

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

import app, { ready } from '../../../src/app';
import rest from '../../../src/configs/rest';
import db from '../../../src/configs/database';
import sheetNameCache from '../../../src/resources/cache/sheet-name.cache';
import SheetServices from '../../../src/services/sheet.services';
import {
    MockDb,
    MockRest,
    fakeSheetRow,
    fakeUserRow,
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

describe('/sheet_delete_section', () => {
    it('caso valido pede confirmacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_delete_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        const body = lastWebhookBody(mockRest);
        expect(JSON.stringify(body.components)).toContain('$a$confirm-delete-section|');
    });

    it('secao inexistente retorna erro de validacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_delete_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Inexistente' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('multiplos erros retornam multiple-validation-errors', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        const spy = jest.spyOn(SheetServices, 'validateDeleteSection').mockResolvedValue([
            { field: 'section', code: 'section-not-found' },
            { field: 'section', code: 'section-size' }
        ]);
        try {
            await postCommandAndWaitReply(
                app,
                buildCommandInteraction({
                    name: 'sheet_delete_section',
                    options: [
                        { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                        { name: 'section', type: 3, value: 'Inexistente' }
                    ]
                })
            );

            expect(lastWebhookBody(mockRest)).toEqual(
                expect.objectContaining({ content: expect.stringContaining('\n') })
            );
        } finally {
            spy.mockRestore();
        }
    });
});

describe('/sheet_delete_section confirmacao ($a$) e autocomplete', () => {
    const promptDelete = async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_delete_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' }
                ]
            })
        );
        return lastWebhookBody(mockRest);
    };

    it('confirmar apaga a secao e sincroniza', async () => {
        const confirmId = findActionId(await promptDelete(), '$a$confirm-delete-section|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('cancelar desabilita os botoes', async () => {
        const cancelId = findActionId(await promptDelete(), '$a$cancel-delete-section|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

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
                name: 'sheet_delete_section',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('autocomplete de section sugere secoes da ficha', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'section', type: 3, value: 'At' },
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(JSON.stringify(res.body.data.choices)).toContain('Atributos');
    });
});

describe('/sheet_delete_section guards e pt-br', () => {
    const baseOptions = [
        { name: 'sheet_name', type: 3, value: 'Test Sheet' },
        { name: 'section', type: 3, value: 'Atributos' }
    ];

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_delete_section', options: baseOptions })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha de outro usuario responde not-sheet-owner', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection({ user_id: 2 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_delete_section', options: baseOptions })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha legacy é migrada antes de pedir confirmacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Atributos: 'x' } })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_delete_section',
                // após a migração a seção passa a se chamar "Info 1"
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Info 1' }
                ]
            })
        );

        // migrate (update #1); a confirmacao em si nao atualiza ainda
        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(JSON.stringify(lastWebhookBody(mockRest).components)).toContain('$a$confirm-delete-section|');
    });

    it('aceita nomes de opcao em pt-br', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_delete_section',
                options: [
                    { name: 'nome_da_ficha', type: 3, value: 'Test Sheet' },
                    { name: 'secao', type: 3, value: 'Atributos' }
                ]
            })
        );

        expect(JSON.stringify(lastWebhookBody(mockRest).components)).toContain('$a$confirm-delete-section|');
    });

    it('falha no patch do confirmar nao quebra (catch coberto)', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_delete_section', options: baseOptions })
        );
        const confirmId = findActionId(lastWebhookBody(mockRest), '$a$confirm-delete-section|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(res.status).toBe(200);
        expect(mockDb.sheets.update).toHaveBeenCalled();
    });

    it('falha no patch do cancelar nao quebra (catch coberto)', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_delete_section', options: baseOptions })
        );
        const cancelId = findActionId(lastWebhookBody(mockRest), '$a$cancel-delete-section|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(res.status).toBe(200);
    });
});

describe('/sheet_delete_section autocomplete pt-br e vazio', () => {
    it('focado nome_da_ficha sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'nome_da_ficha', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('cache vazio responde lista vazia', async () => {
        mockDb.users.findUnique.mockResolvedValue(fakeUserRow({ id: 2, discord_id: '555555555555555555' }));

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' },
                userId: '555555555555555555'
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices).toEqual([]);
    });

    it('focado secao sugere secoes', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'secao', type: 3, value: 'At' },
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('Atributos');
    });

    it('section sem sheet_name responde vazio', async () => {
        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'section', type: 3, value: 'At' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices).toEqual([]);
    });

    it('section com ficha inexistente responde vazio', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'section', type: 3, value: 'At' },
                options: [{ name: 'sheet_name', type: 3, value: 'Inexistente' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices).toEqual([]);
    });

    it('section com ficha legacy migra e sugere', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Atributos: 'x' } })
        );

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_delete_section',
                focusedOption: { name: 'section', type: 3, value: 'In' },
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});
