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

describe('/sheet_rename_attribute', () => {
    it('caso valido pede confirmacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'attribute', type: 3, value: 'Força' },
                    { name: 'new_name', type: 3, value: 'Destreza' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        const body = lastWebhookBody(mockRest);
        expect(JSON.stringify(body.components)).toContain('$a$confirm-rename-attribute|');
    });
});

describe('/sheet_rename_attribute confirmacao ($a$) e autocomplete', () => {
    const promptRename = async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'attribute', type: 3, value: 'Força' },
                    { name: 'new_name', type: 3, value: 'Destreza' }
                ]
            })
        );
        return lastWebhookBody(mockRest);
    };

    it('confirmar renomeia o atributo e sincroniza', async () => {
        const confirmId = findActionId(await promptRename(), '$a$confirm-rename-attribute|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('cancelar desabilita os botoes', async () => {
        const cancelId = findActionId(await promptRename(), '$a$cancel-rename-attribute|');

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
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Inexistente' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'attribute', type: 3, value: 'Força' },
                    { name: 'new_name', type: 3, value: 'Destreza' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('nome duplicado retorna erro de validacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            sheetWithSection({
                attributes: {
                    sections: [
                        {
                            name: 'Atributos',
                            position: 0,
                            type: 0,
                            attributes: [
                                { name: 'Força', value: '10', position: 0, type: 0 },
                                { name: 'Destreza', value: '8', position: 1, type: 0 }
                            ]
                        }
                    ]
                }
            })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'attribute', type: 3, value: 'Força' },
                    { name: 'new_name', type: 3, value: 'Destreza' }
                ]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('autocomplete de section sugere secoes da ficha', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'section', type: 3, value: 'At' },
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(JSON.stringify(res.body.data.choices)).toContain('Atributos');
    });
});

describe('/sheet_rename_attribute guards e pt-br', () => {
    const baseOptions = [
        { name: 'sheet_name', type: 3, value: 'Test Sheet' },
        { name: 'section', type: 3, value: 'Atributos' },
        { name: 'attribute', type: 3, value: 'Força' },
        { name: 'new_name', type: 3, value: 'Destreza' }
    ];

    it('ficha de outro usuario responde not-sheet-owner', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection({ user_id: 2 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_attribute', options: baseOptions })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha legacy é migrada antes de pedir confirmacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Força: '10' } })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                // após a migração: seção "Info 1", atributo "Força"
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Info 1' },
                    { name: 'attribute', type: 3, value: 'Força' },
                    { name: 'new_name', type: 3, value: 'Destreza' }
                ]
            })
        );

        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(JSON.stringify(lastWebhookBody(mockRest).components)).toContain('$a$confirm-rename-attribute|');
    });

    it('multiplos erros retornam multiple-validation-errors', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'select * from users' },
                    // '' seria engolido pelo fallback `||` do comando — usa nome longo (name-size)
                    { name: 'attribute', type: 3, value: 'Força' },
                    { name: 'new_name', type: 3, value: `select * from users ${'x'.repeat(300)}` }
                ]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.stringContaining('\n') }));
    });

    it('aceita nomes de opcao em pt-br', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_attribute',
                options: [
                    { name: 'nome_da_ficha', type: 3, value: 'Test Sheet' },
                    { name: 'secao', type: 3, value: 'Atributos' },
                    { name: 'atributo', type: 3, value: 'Força' },
                    { name: 'novo_nome', type: 3, value: 'Destreza' }
                ]
            })
        );

        expect(JSON.stringify(lastWebhookBody(mockRest).components)).toContain('$a$confirm-rename-attribute|');
    });

    it('falha no patch do confirmar nao quebra (catch coberto)', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_attribute', options: baseOptions })
        );
        const confirmId = findActionId(lastWebhookBody(mockRest), '$a$confirm-rename-attribute|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(res.status).toBe(200);
        expect(mockDb.sheets.update).toHaveBeenCalled();
    });

    it('falha no patch do cancelar nao quebra (catch coberto)', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_attribute', options: baseOptions })
        );
        const cancelId = findActionId(lastWebhookBody(mockRest), '$a$cancel-rename-attribute|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(res.status).toBe(200);
    });
});

describe('/sheet_rename_attribute autocomplete pt-br e vazio', () => {
    it('focado nome_da_ficha sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
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
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' },
                userId: '555555555555555555'
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices).toEqual([]);
    });

    it('focado secao sugere secoes', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
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
                name: 'sheet_rename_attribute',
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
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'section', type: 3, value: 'At' },
                options: [{ name: 'sheet_name', type: 3, value: 'Inexistente' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices).toEqual([]);
    });

    it('focado atributo sugere atributos', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'atributo', type: 3, value: 'Fo' },
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('Força');
    });

    it('attribute com secao errada responde vazio', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'attribute', type: 3, value: 'Fo' },
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Inexistente' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices).toEqual([]);
    });

    it('attribute com ficha inexistente responde vazio', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'attribute', type: 3, value: 'Fo' },
                options: [
                    { name: 'sheet_name', type: 3, value: 'Inexistente' },
                    { name: 'section', type: 3, value: 'Atributos' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices).toEqual([]);
    });

    it('attribute sem sheet_name responde vazio', async () => {
        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'attribute', type: 3, value: 'Fo' },
                options: [{ name: 'section', type: 3, value: 'Atributos' }]
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
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'section', type: 3, value: 'In' },
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('attribute com ficha legacy migra e sugere', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Força: '10' } })
        );

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_attribute',
                focusedOption: { name: 'attribute', type: 3, value: 'Fo' },
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Info 1' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('Força');
    });
});
