const { InteractionResponseType } = require('discord-interactions');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

const appModule = require('../../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const sheetNameCache = require('../../../src/resources/cache/sheet-name.cache').default;
const {
    fakeSheetRow,
    fakeUserRow,
    findActionId,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const {
    buildAutocompleteInteraction,
    buildCommandInteraction,
    buildComponentInteraction,
    postCommandAndWaitReply,
    postSignedInteraction,
    waitAppReady
} = require('../../helpers/interaction-factory');

const mockRest = rest;
const mockDb = db;

const sheetWithSection = (overrides = {}) =>
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

describe('/sheet_rename_section', () => {
    it('caso valido pede confirmacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'new_name', type: 3, value: 'Perícias' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        const body = lastWebhookBody(mockRest);
        expect(JSON.stringify(body.components)).toContain('$a$confirm-rename-section|');
    });
});

describe('/sheet_rename_section confirmacao ($a$) e autocomplete', () => {
    const promptRename = async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'new_name', type: 3, value: 'Perícias' }
                ]
            })
        );
        return lastWebhookBody(mockRest);
    };

    it('confirmar renomeia a secao e sincroniza', async () => {
        const confirmId = findActionId(await promptRename(), '$a$confirm-rename-section|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('cancelar desabilita os botoes', async () => {
        const cancelId = findActionId(await promptRename(), '$a$cancel-rename-section|');

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
                name: 'sheet_rename_section',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});

describe('/sheet_rename_section guards e pt-br', () => {
    const baseOptions = [
        { name: 'sheet_name', type: 3, value: 'Test Sheet' },
        { name: 'section', type: 3, value: 'Atributos' },
        { name: 'new_name', type: 3, value: 'Perícias' }
    ];
    const sheetTwoSections = () =>
        sheetWithSection({
            attributes: {
                sections: [
                    {
                        name: 'Atributos',
                        position: 0,
                        type: 0,
                        attributes: [{ name: 'Força', value: '10', position: 0, type: 0 }]
                    },
                    { name: 'Perícias', position: 1, type: 0, attributes: [] }
                ]
            }
        });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_section', options: baseOptions })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha de outro usuario responde not-sheet-owner', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection({ user_id: 2 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_section', options: baseOptions })
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
                name: 'sheet_rename_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Info 1' },
                    { name: 'new_name', type: 3, value: 'Perícias' }
                ]
            })
        );

        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(JSON.stringify(lastWebhookBody(mockRest).components)).toContain('$a$confirm-rename-section|');
    });

    it('nome duplicado retorna erro de validacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetTwoSections());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_section', options: baseOptions })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('multiplos erros retornam multiple-validation-errors', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_rename_section',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    // longo (size) + padrão SQL (invalid) => 2 erros
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
                name: 'sheet_rename_section',
                options: [
                    { name: 'nome_da_ficha', type: 3, value: 'Test Sheet' },
                    { name: 'secao', type: 3, value: 'Atributos' },
                    { name: 'novo_nome', type: 3, value: 'Perícias' }
                ]
            })
        );

        expect(JSON.stringify(lastWebhookBody(mockRest).components)).toContain('$a$confirm-rename-section|');
    });

    it('falha no patch do confirmar nao quebra (catch coberto)', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_section', options: baseOptions })
        );
        const confirmId = findActionId(lastWebhookBody(mockRest), '$a$confirm-rename-section|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(res.status).toBe(200);
        expect(mockDb.sheets.update).toHaveBeenCalled();
    });

    it('falha no patch do cancelar nao quebra (catch coberto)', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet_rename_section', options: baseOptions })
        );
        const cancelId = findActionId(lastWebhookBody(mockRest), '$a$cancel-rename-section|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(res.status).toBe(200);
    });
});

describe('/sheet_rename_section autocomplete pt-br e vazio', () => {
    it('focado nome_da_ficha sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_rename_section',
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
                name: 'sheet_rename_section',
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
                name: 'sheet_rename_section',
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
                name: 'sheet_rename_section',
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
                name: 'sheet_rename_section',
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
                name: 'sheet_rename_section',
                focusedOption: { name: 'section', type: 3, value: 'In' },
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});
