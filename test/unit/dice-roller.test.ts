// Testes unitários puros (sem HTTP, sem mocks): site da lógica de dados.
import {
    diceRoller,
    formatDiceEmbedOutput,
    formatDiceStringOutput,
    validateDiceString
} from '../../src/resources/utils/dice-roller';

describe('validateDiceString', () => {
    it.each(['1d20', '20', '3d6+2', '2d8+2', '1d20v', '4d6d1', '1d20>10', '1d20<5'])('aceita "%s"', dice => {
        expect(validateDiceString(dice)).toBe(true);
    });

    it.each(['abc', '', '0d20', '1001d20', '1d1001', '@#$'])('rejeita "%s"', dice => {
        expect(validateDiceString(dice)).toBe(false);
    });

    // Quirks documentados do validador (ramo sem checagem de zero):
    // 'd' normaliza para '1d' e '1d0' passa na validacao.
    it.each(['d', '1d0'])('quirk: aceita "%s"', dice => {
        expect(validateDiceString(dice)).toBe(true);
    });

    it.each([
        ['d20 (prefixo d)', 'd20', true],
        // quirk: regex inicial não tem flag `i`, então 'D' maiúsculo é rejeitado
        // mesmo com o código tratando 'D' adiante
        ['D20 maiúsculo rejeitado', 'D20', false],
        ['quantidade > 1000', '2000d6', false],
        ['faces > 1000', '1d2000', false],
        ['threshold > 100000', '2d6>100001', false],
        ['threshold zero', '2d6>0', false],
        ['threshold menor zero', '2d6<0', false],
        ['numero puro gigante', '100001', false],
        ['maior e menor juntos', '1d6>2<4', true],
        ['vantagem', '2d6v', true],
        ['desvantagem', 'd6d6', true],
        ['multi com vantagem', '2d6v+3', true],
        ['threshold com d-prefixo', 'd6>2', true],
        ['threshold estourado com d-prefixo', 'd6>100001', false],
        ['threshold puro estourado', '6>100001', false],
        ['threshold menor puro estourado', '6<100001', false],
        ['threshold puro ok', '6>2', true],
        ['threshold menor puro ok', '6<20', true],
        ['threshold duplo estourado', '6>2<100001', false],
        ['3 partes valido', '12d34d56', true],
        ['3 partes quantidade estourada', '2000d34d56', false],
        ['3 partes faces estouradas', '12d2000d1', false],
        ['3 partes com filtro ok', '12d34d56>7', true],
        ['3 partes com filtro menor ok', '12d34d56<7', true],
        ['3 partes com filtros ok', '12d34d56>7<8', true],
        ['3 partes filtro estourado', '12d34d56>100001', false],
        ['3 partes filtro menor zero', '12d34d56<0', false],
        ['3 partes trailing d', '12d34d', true],
        ['2 partes trailing d (quirk)', '12d', true],
        ['4 partes (invalido)', '12d34d56d78', false],
        // quirk: no ramo both do length-2, Number('100001<4') é NaN e NaN
        // derrota todas as comparações — threshold ignorado
        ['quirk: both com threshold gigante passa', '1d6>100001<4', true],
        ['2 partes filtro menor estourado', '1d6>2<100001', false],
        ['quirk: both com threshold gigante passa (7 digitos)', '1d6>1000001<4', true],
        ['3 partes com filtro', '1d2d3>4', true],
        // quirk: ramo sem `else` para length > 3 (só existe no outro ramo)
        ['4 partes com d passa (quirk)', '1d2d3d4', true],
        ['quirk: 6d sem faces passa', '6d', true],
        ['d solto em soma', 'd+5', true]
    ])('validacao de tamanho/sintaxe: %s', (_title, dice, expected) => {
        expect(validateDiceString(dice)).toBe(expected);
    });
});

describe('validateDiceString', () => {
    it.each(['1d20', '20', '3d6+2', '2d8+2', '1d20v', '4d6d1', '1d20>10', '1d20<5'])('aceita "%s"', dice => {
        expect(validateDiceString(dice)).toBe(true);
    });

    it.each(['abc', '', '0d20', '1001d20', '1d1001', '@#$'])('rejeita "%s"', dice => {
        expect(validateDiceString(dice)).toBe(false);
    });

    // Quirks documentados do validador (ramo sem checagem de zero):
    // 'd' normaliza para '1d' e '1d0' passa na validacao.
    it.each(['d', '1d0'])('quirk: aceita "%s"', dice => {
        expect(validateDiceString(dice)).toBe(true);
    });
});

describe('diceRoller', () => {
    it('normaliza "20" para 1d20', () => {
        const result = diceRoller('20') as { results: number[]; sum: number };
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toBeGreaterThanOrEqual(1);
        expect(result.results[0]).toBeLessThanOrEqual(20);
    });

    it('1d1 sempre resulta 1', () => {
        const result = diceRoller('1d1') as { sum: number; final?: number };
        expect(result.sum).toBe(1);
    });

    it('expressao 2d1+3 resulta final 5', () => {
        const result = diceRoller('2d1+3') as { final: number };
        expect(result.final).toBe(5);
    });

    it('lanca RangeError controlado para dado invalido', () => {
        expect(() => diceRoller('abc')).toThrow('Invalid dice string');
    });

    it.each([
        ['precedencia: 2 + 3*2', '2d1+3d1*2d1', 8],
        ['precedencia: 10 - 2*3', '10d1-2d1*3d1', 4],
        ['divisao exata', '6d1/2', 3],
        ['operando numerico', '2d1+5', 7]
    ])('aritmetica deterministica (d1): %s', (_title, dice, expected) => {
        const result = diceRoller(dice) as { final: number };
        expect(result.final).toBe(expected);
    });

    it('divisao com resto retorna float com 2 casas', () => {
        const result = diceRoller('7d1/2') as { final: number };
        expect(result.final).toBe(3.5);
    });

    it('normaliza "d20" para 1d20', () => {
        const result = diceRoller('d20') as { results: number[]; diceString: string };
        expect(result.results).toHaveLength(1);
        expect(result.results[0]).toBeGreaterThanOrEqual(1);
        expect(result.results[0]).toBeLessThanOrEqual(20);
    });

    it('vantagem (v) usa o maior resultado', () => {
        const result = diceRoller('2d1v') as {
            advantage: number;
            has: { advantage: boolean };
        };
        expect(result.has.advantage).toBe(true);
        expect(result.advantage).toBe(1);
    });

    it('desvantagem (dd) usa o menor resultado', () => {
        const result = diceRoller('2d1d1') as {
            disadvantage: number;
            has: { disadvantage: boolean };
        };
        expect(result.has.disadvantage).toBe(true);
        expect(result.disadvantage).toBe(1);
    });

    it('maior-que (>) filtra soma', () => {
        const result = diceRoller('3d1>1') as {
            greater: number[];
            greaterSum: number;
            has: { greater: boolean };
        };
        expect(result.has.greater).toBe(true);
        expect(result.greater).toEqual([]);
        expect(result.greaterSum).toBe(0);
    });

    it('menor-que (<) filtra soma', () => {
        const result = diceRoller('3d1<2') as {
            less: number[];
            lessSum: number;
            has: { less: boolean };
        };
        expect(result.has.less).toBe(true);
        expect(result.less).toEqual([1, 1, 1]);
        expect(result.lessSum).toBe(3);
    });

    it('vantagem entra no calculo da expressao', () => {
        const result = diceRoller('2d1v+5') as { final: number };
        expect(result.final).toBe(6);
    });

    it('desvantagem entra no calculo da expressao', () => {
        const result = diceRoller('2d1d1+5') as { final: number };
        expect(result.final).toBe(6);
    });

    it('segundo operando com vantagem entra no calculo', () => {
        const result = diceRoller('5+2d1v') as { final: number };
        expect(result.final).toBe(6);
    });

    it('d solto em soma normaliza para 1d', () => {
        const result = diceRoller('d+5') as { final: number };
        expect(result.final).toBe(6);
    });

    it('d20 com operador resolve', () => {
        const result = diceRoller('d20+5') as { final: number };
        expect(result.final).toBeGreaterThanOrEqual(6);
        expect(result.final).toBeLessThanOrEqual(25);
    });

    it('operador solto retorna o proprio token (quirk)', () => {
        expect(diceRoller('+')).toBe('+');
    });
});

describe('formatDiceEmbedOutput', () => {
    it('gera embed com descricao ini', () => {
        const embed = formatDiceEmbedOutput(diceRoller('1d1')).toJSON();
        expect(embed.description).toContain('```ini');
        expect(embed.description).toContain('1d1');
    });

    it('multi-dado mostra operadores e resultado', () => {
        const embed = formatDiceEmbedOutput(diceRoller('2d1+3')).toJSON();
        expect(embed.description).toContain('2d1');
        expect(embed.description).toContain('+');
        expect(embed.description).toContain('Resultado: 5');
    });

    it('com idioma usa chave localizada', () => {
        const embed = formatDiceEmbedOutput(diceRoller('2d1+3'), 'en-us' as Available_Languages).toJSON();
        expect(embed.description).toContain('Result: 5');
    });

    it('vantagem mostra seta e melhor valor', () => {
        const embed = formatDiceEmbedOutput(diceRoller('2d1v')).toJSON();
        expect(embed.description).toContain('v( 1 )');
    });

    it('multi com vantagem mostra seta', () => {
        const embed = formatDiceEmbedOutput(diceRoller('2d1v+1d1')).toJSON();
        expect(embed.description).toContain('v(');
    });

    it('multi com desvantagem mostra d()', () => {
        const embed = formatDiceEmbedOutput(diceRoller('2d1d1+1d1')).toJSON();
        expect(embed.description).toContain('d(');
    });

    it('multi com maior-que mostra filtro', () => {
        const embed = formatDiceEmbedOutput(diceRoller('3d1>1+1d1')).toJSON();
        expect(embed.description).toContain('>');
    });

    it('d20 com operador formata (sem normalizar o prefixo)', () => {
        const embed = formatDiceEmbedOutput(diceRoller('d20+5')).toJSON();
        expect(embed.description).toContain('d20');
    });
});

describe('formatDiceStringOutput', () => {
    it('dado simples formata soma', () => {
        expect(formatDiceStringOutput(diceRoller('1d1'))).toContain('1');
    });

    it('expressao formata com final', () => {
        const out = formatDiceStringOutput(diceRoller('2d1+3'));
        expect(out).toContain('=');
        expect(out).toContain('5');
    });

    it('vantagem formata com v', () => {
        expect(formatDiceStringOutput(diceRoller('2d1v'))).toContain('v');
    });

    it('desvantagem formata com d', () => {
        expect(formatDiceStringOutput(diceRoller('2d1d1'))).toContain('d');
    });

    it('maior-que formata filtro', () => {
        expect(formatDiceStringOutput(diceRoller('3d1>1'))).toContain('>');
    });

    it('menor-que formata filtro', () => {
        expect(formatDiceStringOutput(diceRoller('3d1<2'))).toContain('<');
    });

    it('varios resultados listam valores e soma', () => {
        expect(formatDiceStringOutput(diceRoller('3d1'))).toContain('[1, 1, 1]');
    });

    it('multi com desvantagem formata', () => {
        expect(formatDiceStringOutput(diceRoller('2d1d1+1d1'))).toContain('d');
    });

    it('multi com maior-que formata', () => {
        expect(formatDiceStringOutput(diceRoller('3d1>1+1d1'))).toContain('>');
    });

    it('d20 com operador formata normalizado', () => {
        expect(formatDiceStringOutput(diceRoller('d20+5'))).toContain('d20');
    });
});
