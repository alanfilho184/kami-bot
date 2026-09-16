const { InteractionResponseType } = require('discord-interactions');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

const appModule = require('../../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const {
    fakeSheetRow,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks,
    waitForCall
} = require('../../helpers/mock-factories');
const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../../helpers/interaction-factory');

const mockRest = rest;
const mockDb = db;

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/sheet_configure_password', () => {
    it('atualiza a senha com hash', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(fakeSheetRow({ id: 10, user_id: 1 }));

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_password',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'new_sheet_password', type: 3, value: 'nova-senha' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        // bcrypt roda depois do acknowledge — espera determinística.
        await waitForCall(mockDb.sheets.update);
        expect(mockDb.sheets.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ sheet_password: expect.stringMatching(/^\$2[aby]\$/) })
            })
        );
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('sem senha responde invalid-args', async () => {
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_password',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('senha vazia responde invalid-args', async () => {
        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_password',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'new_sheet_password', type: 3, value: '   ' }
                ]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_password',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Inexistente' },
                    { name: 'new_sheet_password', type: 3, value: 'nova-senha' }
                ]
            })
        );

        expect(mockDb.sheets.update).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });

    it('aceita nomes de opcao em pt-br', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(fakeSheetRow({ id: 10, user_id: 1 }));

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_configure_password',
                options: [
                    { name: 'nome_da_ficha', type: 3, value: 'Test Sheet' },
                    { name: 'nova_senha_da_ficha', type: 3, value: 'outra-senha' }
                ]
            })
        );

        await waitForCall(mockDb.sheets.update);
        expect(mockDb.sheets.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ sheet_password: expect.stringMatching(/^\$2[aby]\$/) })
            })
        );
    });
});
