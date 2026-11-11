jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));
jest.mock('../../../src/commands/sheet/sheet-send', () => {
    class SheetTooComplexError extends Error {}

    return {
        createSheetEmbed: jest.fn(() => [{ title: 'embed' }]),
        buildSheetTooComplexContent: jest.fn(() => 'FICHA COMPLEXA'),
        SheetTooComplexError
    };
});

const sheetSendMock = require('../../../src/commands/sheet/sheet-send');
const syncSheetModule = require('../../../src/resources/utils/sync-sheet');
const syncSheet = syncSheetModule.default;
const { MAX_IRT_SYNC_FAILURES } = syncSheetModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const {
    fakeSheetRow,
    fakeUserRow,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');

const sheet = fakeSheetRow({
    id: 10,
    last_use: new Date('2026-11-06T15:00:00Z')
});
const user = fakeUserRow({ id: 1 });

describe('syncSheet', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupDefaultRestMocks(rest);
        setupDefaultDbMocks(db);
        sheetSendMock.createSheetEmbed.mockImplementation(() => [{ title: 'embed' }]);
        sheetSendMock.buildSheetTooComplexContent.mockReturnValue('FICHA COMPLEXA');
        db.$executeRaw.mockResolvedValue(1);
        db.$queryRaw.mockResolvedValue([{ id: 7, last_synced_at: null }]);
    });

    it('atualiza cada mensagem IRT e grava last_synced_at', async () => {
        db.irt_sheets.findMany.mockResolvedValue([
            {
                id: 7,
                sheet_id: 10,
                user_id: 1,
                msg_id: '111111111111111111',
                channel_id: '222222222222222222'
            }
        ]);

        const result = await syncSheet({ sheet, user, language: 'pt-br' });

        expect(result).toEqual({ updated: 1, failed: 0, skipped: false });
        expect(rest.patch).toHaveBeenCalledWith(
            expect.stringContaining('/channels/222222222222222222/messages/111111111111111111'),
            expect.objectContaining({ body: expect.objectContaining({ embeds: expect.any(Array) }) })
        );
        expect(db.$executeRaw).toHaveBeenCalledTimes(1);
        expect(db.$executeRaw.mock.calls[0][0].join('')).toContain('sync_failures = 0');
    });

    it('mantém last_synced_at sem atualizar quando o Discord falha', async () => {
        db.irt_sheets.findMany.mockResolvedValue([
            {
                id: 7,
                sheet_id: 10,
                user_id: 1,
                msg_id: '111111111111111111',
                channel_id: '222222222222222222'
            }
        ]);
        rest.patch.mockRejectedValueOnce(new Error('Discord fora'));

        const result = await syncSheet({ sheet, user, language: 'pt-br' });

        expect(result).toEqual({ updated: 0, failed: 1, skipped: false });
        expect(db.$executeRaw).not.toHaveBeenCalled();
        expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('conta Unknown Message e mantém o vínculo abaixo do limite', async () => {
        db.irt_sheets.findMany.mockResolvedValue([
            {
                id: 7,
                sheet_id: 10,
                user_id: 1,
                msg_id: '111111111111111111',
                channel_id: '222222222222222222'
            }
        ]);
        db.$queryRaw
            .mockResolvedValueOnce([{ id: 7, last_synced_at: null }])
            .mockResolvedValueOnce([{ sync_failures: 1 }]);
        rest.patch.mockRejectedValueOnce({ rawError: { code: 10008, message: 'Unknown Message' } });

        const result = await syncSheet({ sheet, user, language: 'pt-br' });

        expect(result).toEqual({ updated: 0, failed: 1, skipped: false });
        expect(db.$queryRaw).toHaveBeenCalledTimes(2);
        expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('remove o vínculo IRT ao atingir o limite de Unknown Message', async () => {
        db.irt_sheets.findMany.mockResolvedValue([
            {
                id: 7,
                sheet_id: 10,
                user_id: 1,
                msg_id: '111111111111111111',
                channel_id: '222222222222222222'
            }
        ]);
        db.$queryRaw
            .mockResolvedValueOnce([{ id: 7, last_synced_at: null }])
            .mockResolvedValueOnce([{ sync_failures: MAX_IRT_SYNC_FAILURES }]);
        rest.patch.mockRejectedValueOnce({ code: 10008, message: 'Unknown Message' });

        const result = await syncSheet({ sheet, user, language: 'pt-br' });

        expect(result).toEqual({ updated: 0, failed: 1, skipped: false });
        expect(db.$executeRaw).toHaveBeenCalledTimes(1);
        expect(db.$executeRaw.mock.calls[0][0].join('')).toContain('DELETE FROM irt_sheets');
    });

    it('ignora ficha sem vínculo IRT', async () => {
        db.irt_sheets.findMany.mockResolvedValue([]);

        const result = await syncSheet({ sheet, user, language: 'pt-br' });

        expect(result).toEqual({ updated: 0, failed: 0, skipped: true });
        expect(rest.patch).not.toHaveBeenCalled();
    });

    it('usa pt-br quando o usuário ainda não tem users_config', async () => {
        db.irt_sheets.findMany.mockResolvedValue([
            {
                id: 7,
                sheet_id: 10,
                user_id: 1,
                msg_id: '111111111111111111',
                channel_id: '222222222222222222'
            }
        ]);

        await syncSheet({ sheet, user: fakeUserRow({ id: 1, language: undefined }) });

        expect(sheetSendMock.createSheetEmbed).toHaveBeenCalledWith(expect.anything(), 'pt-br');
    });

    it('desativa o IRT e avisa quando a ficha é complexa demais', async () => {
        db.irt_sheets.findMany.mockResolvedValue([
            {
                id: 7,
                sheet_id: 10,
                user_id: 1,
                msg_id: '111111111111111111',
                channel_id: '222222222222222222'
            }
        ]);
        sheetSendMock.createSheetEmbed.mockImplementation(() => {
            throw new sheetSendMock.SheetTooComplexError('too complex');
        });

        const result = await syncSheet({ sheet, user, language: 'pt-br' });

        expect(result).toEqual({ updated: 0, failed: 0, skipped: false, deactivated: 1 });
        expect(rest.patch).toHaveBeenCalledWith(
            expect.stringContaining('/channels/222222222222222222/messages/111111111111111111'),
            expect.objectContaining({
                body: expect.objectContaining({ content: 'FICHA COMPLEXA', components: [] })
            })
        );
        expect(db.irt_sheets.deleteMany).toHaveBeenCalled();
    });
});
