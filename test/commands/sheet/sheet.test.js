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
    findActionId,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks,
    waitForCall
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

const sheetOpts = (value) => [
    { name: 'sheet_name', type: 3, value },
    { name: 'component_type', type: 3, value: '0' },
    { name: 'section', type: 3, value: 'Atributos' },
    { name: 'attribute', type: 3, value: 'Força' },
    { name: 'value', type: 3, value }
];

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/sheet criar/editar', () => {
    it('ficha inexistente pede confirmacao de criacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);
        mockDb.sheets.count.mockResolvedValue(0);

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Nova Ficha') })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        const body = lastWebhookBody(mockRest);
        expect(body.content).toEqual(expect.stringContaining('Nova Ficha'));
        expect(JSON.stringify(body.components)).toContain('$a$confirm-new-sheet|');
    });

    it('limite de 5 fichas para nao-premium', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);
        mockDb.sheets.count.mockResolvedValue(5);

        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'sheet', options: sheetOpts('Outra') }));

        expect(mockDb.sheets.create).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('edita atributo TEXT existente', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Test Sheet') })
        );

        expect(res.status).toBe(200);
        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: 'Ficha editada com sucesso!' }));
    });

    it('valor invalido retorna erro de validacao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet',
                options: sheetOpts('Test Sheet').map(o => (o.name === 'value' ? { ...o, value: '' } : o))
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('autocomplete de sheet_name sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');
        sheetNameCache.add(1, 'Testamento');

        // Autocomplete responde direto (sem reply) — sem espera.
        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8); // APPLICATION_COMMAND_AUTOCOMPLETE_RESULT
        expect(res.body.data.choices.length).toBeGreaterThan(0);
        expect(res.body.data.choices[0]).toEqual(
            expect.objectContaining({ name: expect.any(String), value: expect.any(String) })
        );
    });
});

describe('/sheet validacoes e permissoes', () => {
    it('ficha de outro usuario responde not-sheet-owner', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection({ user_id: 2 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Test Sheet') })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('multiplos erros retornam multiple-validation-errors', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet',
                options: sheetOpts('Test Sheet').map(o =>
                    o.name === 'attribute' || o.name === 'value' ? { ...o, value: '' } : o
                )
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha legacy é migrada antes de editar', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Força: '10' } })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Test Sheet') })
        );

        expect(res.status).toBe(200);
        // 1 update da migração + 1 da edição
        await waitForCall(mockDb.sheets.update, 2);
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: 'Ficha editada com sucesso!' }));
    });
});

describe('/sheet confirmacao de criacao ($a$)', () => {
    it('confirmar cria a ficha e executa a edicao', async () => {
        mockDb.sheets.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValue(sheetWithSection({ sheet_name: 'Nova Ficha' }));
        mockDb.sheets.count.mockResolvedValue(0);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Nova Ficha') })
        );
        const confirmId = findActionId(lastWebhookBody(mockRest), '$a$confirm-new-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));
        // a ação re-executa /sheet, que responde de novo (2 patches após o prompt)
        await waitForCall(mockRest.patch, 3);

        expect(mockDb.sheets.create).toHaveBeenCalled();
        expect(mockDb.sheets.update).toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: 'Ficha editada com sucesso!' }));
    });

    it('cancelar desabilita os botoes', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);
        mockDb.sheets.count.mockResolvedValue(0);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Nova Ficha') })
        );
        const cancelId = findActionId(lastWebhookBody(mockRest), '$a$cancel-new-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(mockDb.sheets.create).not.toHaveBeenCalled();
        const body = lastWebhookBody(mockRest);
        expect(body.content).toEqual(expect.any(String));
        for (const button of body.components[0].components) {
            expect(button.disabled).toBe(true);
        }
    });
});

describe('/sheet autocomplete avancado', () => {
    const ctx = {
        sheet: { name: 'sheet_name', type: 3, value: 'Test Sheet' },
        componentList: { name: 'component_type', type: 3, value: '3' },
        section: { name: 'section', type: 3, value: 'Atributos' },
        attribute: { name: 'attribute', type: 3, value: 'Força' }
    };

    it('section sugere secoes da ficha', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'section', type: 3, value: 'At' },
                options: [ctx.sheet]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(JSON.stringify(res.body.data.choices)).toContain('Atributos');
    });

    it('attribute sugere atributos da secao', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'attribute', type: 3, value: 'Fo' },
                options: [ctx.sheet, ctx.section]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(JSON.stringify(res.body.data.choices)).toContain('Força');
    });

    it('value LIST sugere acao add', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            sheetWithSection({
                attributes: {
                    sections: [
                        {
                            name: 'Atributos',
                            position: 0,
                            type: 0,
                            attributes: [
                                {
                                    name: 'Inventário',
                                    value: { items: [{ name: 'Poção', quantity: 2 }] },
                                    position: 0,
                                    type: 3
                                }
                            ]
                        }
                    ]
                }
            })
        );

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'value', type: 3, value: '' },
                options: [
                    ctx.sheet,
                    ctx.componentList,
                    ctx.section,
                    { name: 'attribute', type: 3, value: 'Inventário' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('value BAR sugere +passo/-passo', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            sheetWithSection({
                attributes: {
                    sections: [
                        {
                            name: 'Atributos',
                            position: 0,
                            type: 0,
                            attributes: [
                                {
                                    name: 'Vida',
                                    value: { actual: 10, max: 20, min: 0, step: 1 },
                                    position: 0,
                                    type: 4
                                }
                            ]
                        }
                    ]
                }
            })
        );

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'value', type: 3, value: '' },
                options: [
                    ctx.sheet,
                    { name: 'component_type', type: 3, value: '4' },
                    ctx.section,
                    { name: 'attribute', type: 3, value: 'Vida' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('position sugere posicoes vizinhas', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'position', type: 3, value: '' },
                options: [ctx.sheet, ctx.section, ctx.attribute]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('autocomplete sem sheet_name responde vazio', async () => {
        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'section', type: 3, value: 'At' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices).toEqual([]);
    });
});

describe('/sheet autocomplete value (ficha inexistente)', () => {
    const ctxList = (value) => ({
        name: 'sheet',
        focusedOption: { name: 'value', type: 3, value },
        options: [
            { name: 'sheet_name', type: 3, value: 'Nova Ficha' },
            { name: 'component_type', type: 3, value: '3' }
        ]
    });

    it.each([
        ['sugestao inicial de add', '', 'add: 1 | item de exemplo'],
        ['exemplo add sem quantidade', 'add', 'add: 0 | Seu item aqui'],
        ['quantidade + placeholder de item', 'add: 2 |', 'add: 2 | Seu item aqui'],
        ['quantidade + item', 'add: 2 | Poção', 'add: 2 | Poção'],
        ['acao del', 'del: Espada', 'Atributo não encontrado.'],
        ['acao mod', 'mod item 1: 2 | Elixir', 'Atributo não encontrado.']
    ])('value LIST sem ficha: %s', async (_title, value, expected) => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(ctxList(value)));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(JSON.stringify(res.body.data.choices)).toContain(expected);
    });
});

describe('/sheet autocomplete value (atributo inexistente)', () => {
    const ctxList = (value) => ({
        name: 'sheet',
        focusedOption: { name: 'value', type: 3, value },
        options: [
            { name: 'sheet_name', type: 3, value: 'Test Sheet' },
            { name: 'component_type', type: 3, value: '3' },
            { name: 'section', type: 3, value: 'Atributos' },
            { name: 'attribute', type: 3, value: 'Inexistente' }
        ]
    });

    it.each([
        ['sugestao inicial de add', '', 'add: 1 | item de exemplo'],
        ['acao del sem atributo', 'del: Espada', 'Atributo não encontrado.'],
        ['acao mod sem atributo', 'mod item 1: 2 | Elixir', 'Atributo não encontrado.']
    ])('value LIST sem atributo: %s', async (_title, value, expected) => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(ctxList(value)));

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(JSON.stringify(res.body.data.choices)).toContain(expected);
    });
});

describe('/sheet autocomplete value (LIST/BAR existentes)', () => {
    const listSheet = () =>
        sheetWithSection({
            attributes: {
                sections: [
                    {
                        name: 'Atributos',
                        position: 0,
                        type: 0,
                        attributes: [
                            {
                                name: 'Inventário',
                                value: { items: [{ name: 'Poção', quantity: 2 }] },
                                position: 0,
                                type: 3
                            }
                        ]
                    }
                ]
            }
        });
    const barSheet = (barValue) =>
        sheetWithSection({
            attributes: {
                sections: [
                    {
                        name: 'Atributos',
                        position: 0,
                        type: 0,
                        attributes: [{ name: 'Vida', value: barValue, position: 0, type: 4 }]
                    }
                ]
            }
        });
    const valueCtx = (value, componentType, attribute) => ({
        name: 'sheet',
        focusedOption: { name: 'value', type: 3, value },
        options: [
            { name: 'sheet_name', type: 3, value: 'Test Sheet' },
            { name: 'component_type', type: 3, value: componentType },
            { name: 'section', type: 3, value: 'Atributos' },
            { name: 'attribute', type: 3, value: attribute }
        ]
    });

    it('LIST del lista itens existentes', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(listSheet());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction(valueCtx('del: Poção', '3', 'Inventário'))
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('del: Poção');
    });

    it('LIST mod sugere edicao do item', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(listSheet());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction(valueCtx('mod item 1: 2 | Elixir', '3', 'Inventário'))
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('Elixir');
    });

    it('LIST add com quantidade e item', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(listSheet());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction(valueCtx('add: 2 | Poção', '3', 'Inventário'))
        );

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('add: 2 | Poção');
    });

    it('BAR +5 projeta novo valor', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(barSheet({ actual: 10, max: 20, min: 0, step: 1 }));

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(valueCtx('+5', '4', 'Vida')));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('15/20');
    });

    it('BAR -3 projeta novo valor', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(barSheet({ actual: 10, max: 20, min: 0, step: 1 }));

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(valueCtx('-3', '4', 'Vida')));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('7/20');
    });

    it('BAR x/y ecoa valor', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(barSheet({ actual: 10, max: 20, min: 0, step: 1 }));

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(valueCtx('10/100', '4', 'Vida')));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('10/100');
    });

    it('BAR texto livre sugere passos', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(barSheet({ actual: 10, max: 20, min: 0, step: 1 }));

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(valueCtx('xyz', '4', 'Vida')));

        expect(res.status).toBe(200);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('BAR sem valor atual sugere exemplo', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(barSheet({}));

        const res = await postSignedInteraction(app, buildAutocompleteInteraction(valueCtx('', '4', 'Vida')));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body.data.choices)).toContain('50/100');
    });

    it('position com valor sugere posicao correspondente', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(sheetWithSection());

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet',
                focusedOption: { name: 'position', type: 3, value: '1' },
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'section', type: 3, value: 'Atributos' },
                    { name: 'attribute', type: 3, value: 'Força' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});

describe('/sheet confirmacao com nome invalido e falhas de rede', () => {
    const promptNew = async (sheetName) => {
        mockDb.sheets.findFirst.mockResolvedValue(null);
        mockDb.sheets.count.mockResolvedValue(0);
        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'sheet', options: sheetOpts(sheetName) }));
        return lastWebhookBody(mockRest);
    };

    it('confirmar com caracteres invalidos responde erro e nao cria', async () => {
        const confirmId = findActionId(await promptNew('Ruim$Nome'), '$a$confirm-new-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.create).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('confirmar com nome longo responde erro e nao cria', async () => {
        const confirmId = findActionId(await promptNew('x'.repeat(33)), '$a$confirm-new-sheet|');

        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));

        expect(mockDb.sheets.create).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('falha no patch ainda conclui a criacao (catch coberto)', async () => {
        mockDb.sheets.findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValue(sheetWithSection({ sheet_name: 'Nova Ficha' }));
        mockDb.sheets.count.mockResolvedValue(0);
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'sheet', options: sheetOpts('Nova Ficha') })
        );
        const confirmId = findActionId(lastWebhookBody(mockRest), '$a$confirm-new-sheet|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: confirmId }));
        // prompt(1) + confirm com falha(2) + reply da re-execução(3)
        await waitForCall(mockRest.patch, 3);

        expect(mockDb.sheets.create).toHaveBeenCalled();
    });

    it('falha no patch do cancelamento nao quebra (catch coberto)', async () => {
        const cancelId = findActionId(await promptNew('Nova Ficha'), '$a$cancel-new-sheet|');

        mockRest.patch.mockRejectedValueOnce(new Error('rede caiu'));
        const res = await postCommandAndWaitReply(app, buildComponentInteraction({ componentId: cancelId }));

        expect(res.status).toBe(200);
    });
});
