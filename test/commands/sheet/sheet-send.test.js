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
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const {
    buildAutocompleteInteraction,
    buildCommandInteraction,
    postCommandAndWaitReply,
    postSignedInteraction,
    waitAppReady
} = require('../../helpers/interaction-factory');

const mockRest = rest;
const mockDb = db;

const sectionedAttributes = {
    sections: [
        {
            name: 'Atributos',
            position: 0,
            type: 0,
            attributes: [{ name: 'Força', value: '10', position: 0, type: 0 }]
        }
    ]
};

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/sheet_send', () => {
    it('envia a ficha em embeds', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Inexistente' }]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });

    it('opcao sync ativa mensagem sincronizada (irt)', async () => {
        const sheet = fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes });
        mockDb.sheets.findFirst.mockResolvedValue(sheet);
        mockDb.sheets.findUnique.mockResolvedValue(sheet);
        mockDb.irt_sheets.count.mockResolvedValue(0);

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'options', type: 3, value: 'sync' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(mockDb.irt_sheets.create).toHaveBeenCalled();
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_target: 'sheet_send', status: 'SUCCESS' })
            })
        );
    });

    it('limite de 3 sincronizadas para nao-premium', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );
        mockDb.irt_sheets.count.mockResolvedValue(3);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'options', type: 3, value: 'sync' }
                ]
            })
        );

        expect(mockDb.irt_sheets.create).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('renderiza todos os tipos de atributo', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({
                id: 10,
                user_id: 1,
                attributes: {
                    sections: [
                        {
                            name: 'Tudo',
                            position: 0,
                            type: 0,
                            attributes: [
                                { name: 'Texto', value: 'algum texto', position: 0, type: 0 },
                                { name: 'Numero', value: '42', position: 1, type: 1 },
                                { name: 'Imagem', value: 'https://exemplo.com/foto.png', position: 2, type: 2 },
                                {
                                    name: 'Lista',
                                    value: { items: [{ name: 'Poção', quantity: 2 }] },
                                    position: 3,
                                    type: 3
                                },
                                {
                                    name: 'Vida',
                                    value: { actual: 10, max: 20, min: 0, step: 1 },
                                    position: 4,
                                    type: 4
                                }
                            ]
                        }
                    ]
                }
            })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        const body = lastWebhookBody(mockRest);
        expect(body.embeds?.length).toBeGreaterThan(0);
        const flat = JSON.stringify(body.embeds);
        for (const expected of ['Texto', 'Numero', 'Lista', 'Vida']) {
            expect(flat).toContain(expected);
        }
        // IMAGE vira thumbnail do embed, não field
        expect(flat).toContain('https://exemplo.com/foto.png');
    });

    it('ficha legacy é convertida no embed', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Força: '10', Nome: 'Bob' } })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('atributo com overflow gera embed de erro sem quebrar', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({
                id: 10,
                user_id: 1,
                attributes: {
                    sections: [
                        {
                            name: 'Tudo',
                            position: 0,
                            type: 0,
                            attributes: [{ name: 'x'.repeat(300), value: 'v', position: 0, type: 0 }]
                        }
                    ]
                }
            })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('autocomplete de sheet_name sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_send',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });
});
