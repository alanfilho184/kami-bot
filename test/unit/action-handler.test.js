// Regressões do action-handler.
//
// O `run` das ações é assíncrono: o `catch` do handler só pegava throws
// síncronos, então a rejeição escapava sem chegar ao logger estruturado
// (o painel mostrava "0 erros" enquanto o Discord falhava).
const actionHandler = require('../../src/resources/utils/action-handler').default;
const logger = require('../../src/configs/logger').default;

function futureDate() {
    return new Date(Date.now() + 60_000);
}

describe('ActionHandler.executeAction', () => {
    it('executa a ação registrada', async () => {
        const run = jest.fn();
        actionHandler.registerAction('$a$executa|1', { action: run, expireAt: futureDate() });

        const executed = await actionHandler.executeAction('$a$executa|1', 'user-1');

        expect(executed).toBe(true);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('devolve false quando a ação não existe', async () => {
        const executed = await actionHandler.executeAction('$a$inexistente|1', 'user-1');

        expect(executed).toBe(false);
    });

    it('devolve false e não executa quando a ação é de outro usuário', async () => {
        const run = jest.fn();
        actionHandler.registerAction('$a$outro|2', {
            action: run,
            expireAt: futureDate(),
            respondOnlyToUserId: 'user-1'
        });

        const executed = await actionHandler.executeAction('$a$outro|2', 'user-2');

        expect(executed).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it('devolve false quando a ação expirou', async () => {
        const run = jest.fn();
        actionHandler.registerAction('$a$expirada|3', {
            action: run,
            expireAt: new Date(Date.now() - 1000)
        });

        const executed = await actionHandler.executeAction('$a$expirada|3', 'user-1');

        expect(executed).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    it('registra rejeição assíncrona e propaga o erro', async () => {
        const error = new Error('falhou ao aplicar a ação');
        const run = jest.fn(async () => {
            throw error;
        });

        actionHandler.registerAction('$a$erro|4', { action: run, expireAt: futureDate() });

        const spy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

        await expect(actionHandler.executeAction('$a$erro|4', 'user-1')).rejects.toThrow('falhou ao aplicar a ação');

        expect(spy).toHaveBeenCalledWith(
            error,
            expect.objectContaining({ event: 'component.action.error', action: '$a$erro|4' })
        );

        spy.mockRestore();
    });

    it('remove a ação de uso único depois de executar', async () => {
        const run = jest.fn();
        actionHandler.registerAction('$a$unico|5', {
            action: run,
            expireAt: futureDate(),
            singleUse: true
        });

        expect(await actionHandler.executeAction('$a$unico|5', 'user-1')).toBe(true);
        expect(await actionHandler.executeAction('$a$unico|5', 'user-1')).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
    });
});
