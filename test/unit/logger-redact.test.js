const {
    isSensitiveOptionName,
    redactContext,
    redactDiscordOptions,
    redactTextValue
} = require('../../src/logs/redact');

describe('logs/redact', () => {
    it('mascara chaves sensíveis, e-mail e senha em URL do Postgres', () => {
        const redacted = redactContext({
            password: 'valor',
            nested: { token: 'segredo', safe: 'visível' },
            url: 'postgresql://kami:senha@127.0.0.1:5432/kami',
            email: 'alan@example.com'
        });

        expect(redacted).toMatchObject({
            password: '***',
            nested: { token: '***', safe: 'visível' },
            email: 'a***@example.com'
        });
        expect(redacted.url).toBe('postgresql://kami:***@127.0.0.1:5432/kami');
    });

    it('mascara opções sensíveis de comando', () => {
        const options = redactDiscordOptions([
            { name: 'nova_senha_da_ficha', value: 'segredo' },
            { name: 'new_sheet_password', value: 'secret' },
            { name: 'codigo', value: 'ABC123' },
            { name: 'nome_da_ficha', value: 'Ficha' }
        ]);

        expect(options).toEqual([
            { name: 'nova_senha_da_ficha', value: '***' },
            { name: 'new_sheet_password', value: '***' },
            { name: 'codigo', value: '***' },
            { name: 'nome_da_ficha', value: 'Ficha' }
        ]);
    });

    it('reconhece nomes sensíveis e não marca nome de ficha', () => {
        expect(isSensitiveOptionName('nova_senha_da_ficha')).toBe(true);
        expect(isSensitiveOptionName('new_sheet_password')).toBe(true);
        expect(isSensitiveOptionName('codigo')).toBe(true);
        expect(isSensitiveOptionName('nome_da_ficha')).toBe(false);
    });

    it('mascara e-mail em texto livre', () => {
        expect(redactTextValue('falha para alan@example.com')).toBe('falha para a***@example.com');
    });
});
