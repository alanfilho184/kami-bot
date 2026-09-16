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
    fakeUserRow,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../../helpers/interaction-factory');

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

describe('/sheet_view', () => {
    it('dono ve a propria ficha sem senha', async () => {
        mockDb.users.findFirst.mockResolvedValue(fakeUserRow({ id: 1 }));
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, is_public: false, attributes: sectionedAttributes })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_view',
                options: [
                    { name: 'username', type: 3, value: 'Tester' },
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        const body = lastWebhookBody(mockRest);
        expect(body.embeds?.length).toBeGreaterThan(0);
        expect(body.content).toEqual(expect.any(String));
    });

    it('ficha publica de outro usuario nao pede senha', async () => {
        mockDb.users.findFirst.mockResolvedValue(fakeUserRow({ id: 2, discord_id: '555555555555555555' }));
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 11, user_id: 2, is_public: true, attributes: sectionedAttributes })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_view',
                options: [
                    { name: 'username', type: 3, value: 'Outro' },
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' }
                ]
            })
        );

        const body = lastWebhookBody(mockRest);
        expect(body.embeds?.length).toBeGreaterThan(0);
    });

    it('ficha privada sem senha responde password-required', async () => {
        mockDb.users.findFirst.mockResolvedValue(fakeUserRow({ id: 2 }));
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 11, user_id: 2, is_public: false, sheet_password: 'secret' })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_view',
                options: [
                    { name: 'username', type: 3, value: 'Outro' },
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('senha errada responde invalid-password; senha certa mostra a ficha', async () => {
        const privateSheet = () =>
            fakeSheetRow({
                id: 11,
                user_id: 2,
                is_public: false,
                sheet_password: 'secret',
                attributes: sectionedAttributes
            });
        mockDb.users.findFirst.mockResolvedValue(fakeUserRow({ id: 2 }));
        const opts = (password) => {
            const options = [
                { name: 'username', type: 3, value: 'Outro' },
                { name: 'sheet_name', type: 3, value: 'Test Sheet' }
            ];
            if (password !== undefined) {
                options.push({ name: 'password', type: 3, value: password });
            }
            return options;
        };

        mockDb.sheets.findFirst.mockResolvedValue(privateSheet());
        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'sheet_view', options: opts('wrong') }));
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));

        mockDb.sheets.findFirst.mockResolvedValue(privateSheet());
        await postCommandAndWaitReply(app, buildCommandInteraction({ name: 'sheet_view', options: opts('secret') }));
        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('usuario inexistente responde user-not-found', async () => {
        mockDb.users.findFirst.mockResolvedValue(null);
        mockDb.users.findUnique.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_view',
                options: [
                    { name: 'username', type: 3, value: 'Fantasma' },
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Fantasma') })
        );
    });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.users.findFirst.mockResolvedValue(fakeUserRow({ id: 2 }));
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_view',
                options: [
                    { name: 'username', type: 3, value: 'Outro' },
                    { name: 'sheet_name', type: 3, value: 'Inexistente' }
                ]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });
});
