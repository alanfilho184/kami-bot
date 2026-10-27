const {
    FAILOVER_ORDER,
    higherPriorityRoles,
    isInstanceRole,
    pickHandbackTarget
} = require('../../src/types/instance');

describe('instance priority', () => {
    it('mantém a ordem fixa primary > secondary > backup', () => {
        expect(FAILOVER_ORDER).toEqual(['primary', 'secondary', 'backup']);
    });

    it('reconhece apenas os papéis válidos', () => {
        expect(isInstanceRole('primary')).toBe(true);
        expect(isInstanceRole('secondary')).toBe(true);
        expect(isInstanceRole('backup')).toBe(true);
        expect(isInstanceRole('master')).toBe(false);
        expect(isInstanceRole(undefined)).toBe(false);
    });

    it('lista os papéis de maior prioridade', () => {
        expect(higherPriorityRoles('primary')).toEqual([]);
        expect(higherPriorityRoles('secondary')).toEqual(['primary']);
        expect(higherPriorityRoles('backup')).toEqual(['primary', 'secondary']);
    });

    it('o secondary devolve o controle ao primary quando ele volta', () => {
        expect(pickHandbackTarget('secondary', ['primary'])).toBe('primary');
        expect(pickHandbackTarget('secondary', [])).toBeNull();
    });

    it('o backup tem preferência pelo primary e depois pelo secondary', () => {
        expect(pickHandbackTarget('backup', ['secondary', 'primary'])).toBe('primary');
        expect(pickHandbackTarget('backup', ['secondary'])).toBe('secondary');
        expect(pickHandbackTarget('backup', [])).toBeNull();
    });

    it('ignora papéis de prioridade igual ou menor', () => {
        expect(pickHandbackTarget('secondary', ['secondary', 'backup'])).toBeNull();
        expect(pickHandbackTarget('backup', ['backup'])).toBeNull();
        expect(pickHandbackTarget('primary', ['primary', 'secondary', 'backup'])).toBeNull();
    });
});
