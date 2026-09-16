// Testes unitários puros de validação de IDs/nomes (sem HTTP, sem mocks).
const { Channel_Id, Discord_Id, Macro_Name, Msg_Id, Server_Id, Sheet_Name } = require('../../src/types/validations');

describe('Discord_Id', () => {
    it('aceita 18-20 digitos', () => {
        expect(new Discord_Id('111111111111111111').discord_id).toBe('111111111111111111');
        expect(Discord_Id.isValid('11111111111111111111')).toBe(true);
    });

    it('rejeita letras, curto e vazio', () => {
        expect(Discord_Id.isValid('abc')).toBe(false);
        expect(Discord_Id.isValid('123')).toBe(false);
        expect(Discord_Id.isValid('')).toBe(false);
        expect(() => new Discord_Id('abc')).toThrow();
    });
});

describe.each([
    ['Server_Id', Server_Id],
    ['Channel_Id', Channel_Id],
    ['Msg_Id', Msg_Id]
])('%s', (_label, Cls) => {
    it('aceita 18 digitos e rejeita inválidos', () => {
        expect(Cls.isValid('333333333333333333')).toBe(true);
        expect(Cls.isValid('x')).toBe(false);
    });
});

describe('Sheet_Name', () => {
    it('aceita nome normal', () => {
        expect(new Sheet_Name('Minha Ficha').sheet_name).toBe('Minha Ficha');
    });

    it('rejeita >32 caracteres', () => {
        expect(Sheet_Name.isValid('a'.repeat(33))).toBe(false);
        expect(() => new Sheet_Name('a'.repeat(33))).toThrow();
    });

    it("rejeita caracteres '$ %", () => {
        expect(Sheet_Name.isValid('ficha$ruim')).toBe(false);
        expect(Sheet_Name.isValid('100%')).toBe(false);
    });
});

describe('Macro_Name', () => {
    it('aceita e rejeita como Sheet_Name', () => {
        expect(Macro_Name.isValid('Macro 1')).toBe(true);
        expect(Macro_Name.isValid('b'.repeat(33))).toBe(false);
    });
});
