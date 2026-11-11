jest.mock('../../../src/controllers/sheet.controller', () => ({
    __esModule: true,
    default: {
        getAllSheetsHead: jest.fn()
    }
}));

const SheetController = require('../../../src/controllers/sheet.controller').default;
const sheetNameCache = require('../../../src/resources/cache/sheet-name.cache').default;

describe('sheet-name.cache', () => {
    beforeEach(async () => {
        SheetController.getAllSheetsHead.mockReset();
        // Limpa o cache de testes anteriores carregando uma lista vazia.
        SheetController.getAllSheetsHead.mockResolvedValue([]);
        await sheetNameCache.loadCache();
    });

    it('carrega, adiciona, renomeia e remove por id', async () => {
        SheetController.getAllSheetsHead.mockResolvedValue([
            { id: 10, user_id: 1, sheet_name: 'Lyra' },
            { id: 11, user_id: 1, sheet_name: 'Voss' }
        ]);

        await sheetNameCache.loadCache();

        expect(sheetNameCache.get(1)).toEqual(expect.arrayContaining(['Lyra', 'Voss']));

        sheetNameCache.upsert(1, 10, 'Lyra Voss');
        expect(sheetNameCache.get(1)).toContain('Lyra Voss');
        expect(sheetNameCache.get(1)).not.toContain('Lyra');

        sheetNameCache.removeById(1, 11);
        expect(sheetNameCache.get(1)).toEqual(['Lyra Voss']);
    });

    it('move as fichas no merge de contas', async () => {
        SheetController.getAllSheetsHead.mockResolvedValue([
            { id: 10, user_id: 1, sheet_name: 'Lyra' },
            { id: 20, user_id: 2, sheet_name: 'Voss' }
        ]);

        await sheetNameCache.loadCache();
        sheetNameCache.moveUser(1, 2);

        expect(sheetNameCache.get(1)).toBeNull();
        expect(sheetNameCache.get(2)).toEqual(expect.arrayContaining(['Lyra', 'Voss']));
    });
});
