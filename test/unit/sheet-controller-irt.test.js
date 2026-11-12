// Regressão do vínculo IRT criado por /ficha_enviar sync.
//
// pg_advisory_xact_lock() retorna void e o Prisma não desserializa colunas
// void em $queryRaw (P2010 "Failed to deserialize column of type 'void'").
// O teste do SQL garante que a função não apareça como coluna de topo.
jest.mock('../../src/configs/database', () => require('../mocks/database'));

const db = require('../../src/configs/database').default;
const SheetController = require('../../src/controllers/sheet.controller').default;

function lastLockQuerySql() {
    const [strings] = db.$queryRaw.mock.calls[0];

    return strings.join('');
}

beforeEach(() => {
    db.$queryRaw.mockResolvedValue([{ locked: 1 }]);
});

describe('SheetController.createIrtSheetWithLimit', () => {
    it('cria o vínculo quando está abaixo do limite', async () => {
        db.irt_sheets.count.mockResolvedValue(2);
        db.irt_sheets.create.mockResolvedValue({ id: 1 });

        const result = await SheetController.createIrtSheetWithLimit(1, 10, 'msg-1', 'channel-1', 3);

        expect(result).toBe('created');
        expect(db.irt_sheets.create).toHaveBeenCalledWith({
            data: {
                user_id: 1,
                sheet_id: 10,
                msg_id: 'msg-1',
                channel_id: 'channel-1'
            }
        });
    });

    it('retorna limit e não cria quando o limite já foi atingido', async () => {
        db.irt_sheets.count.mockResolvedValue(3);

        const result = await SheetController.createIrtSheetWithLimit(1, 10, 'msg-1', 'channel-1', 3);

        expect(result).toBe('limit');
        expect(db.irt_sheets.create).not.toHaveBeenCalled();
    });

    it('premium (sem limite) cria sem contar os vínculos', async () => {
        db.irt_sheets.create.mockResolvedValue({ id: 1 });

        const result = await SheetController.createIrtSheetWithLimit(1, 10, 'msg-1', 'channel-1', null);

        expect(result).toBe('created');
        expect(db.irt_sheets.count).not.toHaveBeenCalled();
        expect(db.irt_sheets.create).toHaveBeenCalledTimes(1);
    });

    it('faz lock, contagem e criação na mesma transação, nesta ordem', async () => {
        db.irt_sheets.count.mockResolvedValue(0);
        db.irt_sheets.create.mockResolvedValue({ id: 1 });

        await SheetController.createIrtSheetWithLimit(1, 10, 'msg-1', 'channel-1', 3);

        expect(db.$transaction).toHaveBeenCalledTimes(1);
        expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
            db.irt_sheets.count.mock.invocationCallOrder[0]
        );
        expect(db.irt_sheets.count.mock.invocationCallOrder[0]).toBeLessThan(
            db.irt_sheets.create.mock.invocationCallOrder[0]
        );
    });

    it('não expõe a coluna void de pg_advisory_xact_lock no resultado', async () => {
        db.irt_sheets.count.mockResolvedValue(0);
        db.irt_sheets.create.mockResolvedValue({ id: 1 });

        await SheetController.createIrtSheetWithLimit(1, 10, 'msg-1', 'channel-1', 3);

        const sql = lastLockQuerySql();

        expect(sql).toContain('pg_advisory_xact_lock');
        expect(sql).not.toMatch(/^\s*SELECT\s+pg_advisory_xact_lock\b/);
    });

    it('mantém o lock por ficha (chave derivada do sheet_id)', async () => {
        db.irt_sheets.count.mockResolvedValue(0);
        db.irt_sheets.create.mockResolvedValue({ id: 1 });

        await SheetController.createIrtSheetWithLimit(1, 10, 'msg-1', 'channel-1', 3);

        const [, lockKey] = db.$queryRaw.mock.calls[0];

        expect(lockKey).toBe('sheet:irt:10');
    });
});
