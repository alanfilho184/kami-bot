const { resolveLogOptions } = require('../../src/logs/options');

describe('logs/options', () => {
    it('envia ao logger e permite webhook por padrão', () => {
        expect(resolveLogOptions()).toMatchObject({
            sendToRemote: true,
            notifyDiscord: false,
            context: {}
        });
        expect(resolveLogOptions({ event: 'app.start' })).toMatchObject({
            sendToRemote: true,
            notifyDiscord: false,
            context: { event: 'app.start' }
        });
    });

    it('remote:false deixa somente no console e remove as flags do contexto', () => {
        const result = resolveLogOptions({
            event: 'debug.local',
            remote: false,
            notifyDiscord: true
        });

        expect(result.sendToRemote).toBe(false);
        expect(result.notifyDiscord).toBe(true);
        expect(result.context).toEqual({ event: 'debug.local' });
    });
});
