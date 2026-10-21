const { isAutomaticDnsEnabled } = require('../../src/modules/dns-policy');

describe('isAutomaticDnsEnabled', () => {
    it('habilita a troca automática apenas em produção', () => {
        expect(isAutomaticDnsEnabled('production')).toBe(true);
        expect(isAutomaticDnsEnabled('development')).toBe(false);
        expect(isAutomaticDnsEnabled('test')).toBe(false);
        expect(isAutomaticDnsEnabled(undefined)).toBe(false);
    });
});
