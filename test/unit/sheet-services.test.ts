// Testes unitários de SheetServices (lógica pura; db mockado por segurança,
// mas validate*/hash não tocam o banco).
// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
jest.mock('../../src/configs/database', () => require('../mocks/database'));

import SheetServices from '../../src/services/sheet.services';
import { Attribute_Type } from '../../src/types/enums';

// Os regexes estáticos têm flag /g e guardam lastIndex entre chamadas:
// um teste que casa o padrão poluiria o próximo. Reseta antes de cada teste
// (dentro de UMA validação o comportamento real com lastIndex é preservado).
beforeEach(() => {
    SheetServices.textRegex.lastIndex = 0;
    SheetServices.numberRegex.lastIndex = 0;
    SheetServices.positiveNumberRegex.lastIndex = 0;
    SheetServices.imageRegex.lastIndex = 0;
});

const baseSheet = (): Sheet => ({
    id: 10,
    user_id: 1,
    sheet_name: 'Test Sheet',
    sheet_password: 'secret',
    is_public: true,
    legacy: false,
    last_use: new Date(),
    attributes: {
        sections: [
            {
                name: 'Atributos',
                position: 0,
                type: 0,
                attributes: [{ name: 'Força', value: '10', position: 0, type: Attribute_Type.TEXT }]
            }
        ]
    }
});

describe('prepareNewSheet', () => {
    it('cria ficha vazia com senha aleatoria', () => {
        const sheet = SheetServices.prepareNewSheet('Nova', 1);
        expect(sheet.sheet_name).toBe('Nova');
        expect(sheet.user_id).toBe(1);
        expect(sheet.sheet_password).toEqual(expect.any(String));
        expect(sheet.attributes).toEqual({ sections: [] });
    });
});

describe('validateModification TEXT', () => {
    it('adiciona atributo em secao nova', async () => {
        const sheet = baseSheet();
        sheet.attributes = { sections: [] } as unknown as Sheet['attributes'];

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.TEXT,
            'Nova Seção',
            'Agilidade',
            'rápido'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections).toHaveLength(1);
        expect(result.attributes.sections[0].attributes[0]).toEqual(
            expect.objectContaining({ name: 'Agilidade', value: 'rápido' })
        );
    });

    it('valor vazio retorna erro value-size', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            'Atributos',
            'Força',
            ''
        )) as Array<{ field: string; code: string }>;

        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual(expect.arrayContaining([{ field: 'value', code: 'value-size' }]));
    });

    it.each([
        ['nome de atributo vazio', 'Atributos', '', 'ok', { field: 'attribute', code: 'name-size' }],
        [
            'nome de atributo invalido (SQL)',
            'Atributos',
            'select * from users',
            'ok',
            { field: 'attribute', code: 'name-invalid' }
        ],
        ['valor longo demais', 'Atributos', 'Força', 'x'.repeat(1025), { field: 'value', code: 'value-size' }],
        [
            'valor invalido (SQL)',
            'Atributos',
            'Força',
            'select * from users',
            { field: 'value', code: 'value-invalid' }
        ],
        ['secao vazia', '', 'Força', 'ok', { field: 'section', code: 'section-size' }],
        ['secao invalida (SQL)', 'select * from users', 'Força', 'ok', { field: 'section', code: 'section-invalid' }]
    ])('TEXT: %s', async (_title, section, attribute, value, expected) => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            section,
            attribute,
            value
        )) as Array<{ field: string; code: string }>;

        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual(expect.arrayContaining([expected]));
    });

    it('TEXT: posicao negativa retorna position-invalid', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            'Atributos',
            'Força',
            'ok',
            -1
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'position', code: 'position-invalid' }]));
    });

    it('TEXT: atualiza valor de atributo existente', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            'Atributos',
            'Força',
            '12'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes[0].value).toBe('12');
    });

    it('TEXT: posicao explicita insere via splice', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            'Atributos',
            'Destreza',
            '8',
            5
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes).toHaveLength(2);
        expect(result.attributes.sections[0].attributes[1]).toEqual(
            expect.objectContaining({ name: 'Destreza', position: 5 })
        );
    });

    it('TEXT: posicao 0 é falsy e cai no push (comportamento atual)', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            'Atributos',
            'Destreza',
            '8',
            0
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes).toHaveLength(2);
    });

    it('tipo de atributo invalido retorna erro', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            99 as Attribute_Type,
            'Atributos',
            'Força',
            'ok'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual([{ field: 'attribute_type', code: 'invalid' }]);
    });
});

describe('validateModification NUMBER (quirk: checagem invertida — válidos rejeitados)', () => {
    it('numero valido retorna value-invalid (comportamento atual)', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.NUMBER,
            'Atributos',
            'Força',
            '42'
        )) as Array<{ field: string; code: string }>;

        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual(expect.arrayContaining([{ field: 'value', code: 'value-invalid' }]));
    });

    it('valor nao-numerico passa na checagem (comportamento atual)', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.NUMBER,
            'Atributos',
            'Força',
            'abc'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
    });

    it('nome vazio retorna name-size', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.NUMBER,
            'Atributos',
            '',
            'abc'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'name-size' }]));
    });

    it.each([
        [
            'nome invalido (SQL)',
            'Atributos',
            'select * from users',
            'abc',
            { field: 'attribute', code: 'name-invalid' }
        ],
        ['valor longo demais', 'Atributos', 'Força', 'x'.repeat(1025), { field: 'value', code: 'value-size' }],
        ['secao vazia', '', 'Força', 'abc', { field: 'section', code: 'section-size' }],
        ['secao invalida (SQL)', 'select * from users', 'Força', 'abc', { field: 'section', code: 'section-invalid' }]
    ])('NUMBER: %s', async (_title, section, attribute, value, expected) => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.NUMBER,
            section,
            attribute,
            value
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([expected]));
    });

    it('NUMBER: posicao negativa retorna position-invalid', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.NUMBER,
            'Atributos',
            'Força',
            'abc',
            -2
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'position', code: 'position-invalid' }]));
    });
});

describe('validateModification IMAGE', () => {
    it('url valida passa', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.IMAGE,
            'Atributos',
            'Retrato',
            'https://exemplo.com/foto.png'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes.find(a => a.name === 'Retrato')).toBeDefined();
    });

    it('url invalida retorna value-invalid', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.IMAGE,
            'Atributos',
            'Retrato',
            'nao-eh-url'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'value', code: 'value-invalid' }]));
    });

    it('nome vazio retorna name-size', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.IMAGE,
            'Atributos',
            '',
            'https://exemplo.com/foto.png'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'name-size' }]));
    });

    it.each([
        [
            'nome invalido (SQL)',
            'Atributos',
            'select * from users',
            'https://exemplo.com/foto.png',
            { field: 'attribute', code: 'name-invalid' }
        ],
        [
            'valor longo demais',
            'Atributos',
            'Retrato',
            `https://exemplo.com/${'x'.repeat(1025)}.png`,
            { field: 'value', code: 'value-size' }
        ],
        ['secao vazia', '', 'Retrato', 'https://exemplo.com/foto.png', { field: 'section', code: 'section-size' }],
        [
            'secao invalida (SQL)',
            'select * from users',
            'Retrato',
            'https://exemplo.com/foto.png',
            { field: 'section', code: 'section-invalid' }
        ]
    ])('IMAGE: %s', async (_title, section, attribute, value, expected) => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.IMAGE,
            section,
            attribute,
            value
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([expected]));
    });

    it('IMAGE: posicao negativa retorna position-invalid', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.IMAGE,
            'Atributos',
            'Retrato',
            'https://exemplo.com/foto.png',
            -1
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'position', code: 'position-invalid' }]));
    });
});

describe('validateModification LIST/BAR', () => {
    it('LIST add acrescenta item', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'add: 2 | Poção'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Inventário');
        expect(attr).toBeDefined();
        expect(JSON.stringify(attr!.value)).toContain('Poção');
    });

    it('BAR mod define actual/max', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Vida',
            value: { actual: 10, max: 20, min: 0, step: 1 } as unknown as string,
            position: 1,
            type: Attribute_Type.BAR
        });

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.BAR,
            'Atributos',
            'Vida',
            '15/20'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Vida');
        expect(attr!.value).toEqual(expect.objectContaining({ actual: 15, max: 20 }));
    });

    const listSheet = (): Sheet => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Inventário',
            value: { items: [{ name: 'Poção', quantity: 2 }] } as unknown as string,
            position: 1,
            type: Attribute_Type.LIST
        });
        return sheet;
    };

    const barSheet = (): Sheet => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Vida',
            value: { actual: 10, max: 20, min: 0, step: 1 } as unknown as string,
            position: 1,
            type: Attribute_Type.BAR
        });
        return sheet;
    };

    it('LIST del remove item existente', async () => {
        const result = (await SheetServices.validateModification(
            listSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'del: Poção'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Inventário');
        expect(JSON.stringify(attr!.value)).not.toContain('Poção');
    });

    it('LIST mod edita item existente', async () => {
        const result = (await SheetServices.validateModification(
            listSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'mod item 1: 5 | Elixir'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Inventário');
        expect(JSON.stringify(attr!.value)).toContain('Elixir');
    });

    it('LIST add em secao nova cria secao e atributo', async () => {
        const sheet = baseSheet();
        sheet.attributes = { sections: [] } as unknown as Sheet['attributes'];

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.LIST,
            'Mochila',
            'Itens',
            'add: 1 | Corda'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].name).toBe('Mochila');
        expect(JSON.stringify(result.attributes.sections[0].attributes)).toContain('Corda');
    });

    it('LIST com quantidade gigante retorna quantity-size', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            `add: ${'9'.repeat(33)} | Poção`
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'value', code: 'quantity-size' }]));
    });

    it('LIST com nome vazio retorna name-size', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            '',
            'add: 1 | Poção'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'name-size' }]));
    });

    it.each([
        [
            'nome invalido (SQL)',
            'Atributos',
            'select * from users',
            'add: 1 | Poção',
            { field: 'attribute', code: 'name-invalid' }
        ],
        [
            'valor longo demais',
            'Atributos',
            'Inventário',
            `add: 1 | ${'x'.repeat(1025)}`,
            { field: 'value', code: 'value-size' }
        ],
        ['secao vazia', '', 'Inventário', 'add: 1 | Poção', { field: 'section', code: 'section-size' }],
        [
            'secao invalida (SQL)',
            'select * from users',
            'Inventário',
            'add: 1 | Poção',
            { field: 'section', code: 'section-invalid' }
        ]
    ])('LIST validacoes de campo: %s', async (_title, section, attribute, value, expected) => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            section,
            attribute,
            value
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([expected]));
    });

    it('LIST com valor invalido (SQL) retorna value-invalid', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'add: 1 | select * from users'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'value', code: 'value-invalid' }]));
    });

    it('LIST com posicao negativa retorna position-invalid', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'add: 1 | Poção',
            -1
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'position', code: 'position-invalid' }]));
    });

    it('LIST add em atributo LIST existente acrescenta', async () => {
        const result = (await SheetServices.validateModification(
            listSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'add: 1 | Corda'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Inventário');
        const items = (attr!.value as unknown as { items: { name: string }[] }).items;
        expect(items).toHaveLength(2);
        expect(items[1].name).toBe('Corda');
    });

    it('LIST add em atributo TEXT recria como lista', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Força',
            'add: 1 | Forte'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Força');
        const items = (attr!.value as unknown as { items: { name: string }[] }).items;
        expect(items).toEqual([{ name: 'Forte', quantity: '1' }]);
    });

    it('LIST add em atributo LIST com valor bruto recria a lista', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Inventário',
            value: 'texto-solto' as unknown as string,
            position: 1,
            type: Attribute_Type.LIST
        });

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.LIST,
            'Atributos',
            'Inventário',
            'add: 1 | Corda'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Inventário');
        const items = (attr!.value as unknown as { items: { name: string }[] }).items;
        expect(items).toEqual([{ name: 'Corda', quantity: '1' }]);
    });

    it('LIST del em secao inexistente cria a secao (quirk: sem else)', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Inexistente',
            'Inventário',
            'del: Poção'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections.find(s => s.name === 'Inexistente')).toBeDefined();
    });

    it('LIST del em atributo TEXT mantem valor bruto', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Força',
            'del: 10'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
    });

    it('LIST mod em atributo TEXT mantem valor bruto', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.LIST,
            'Atributos',
            'Força',
            'mod item 1: 2 | Forte'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
    });

    it('BAR add (+) soma no actual', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Vida',
            '+3'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Vida');
        expect(attr!.value).toEqual(expect.objectContaining({ actual: 13 }));
    });

    it('BAR sub (-) subtrai do actual', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Vida',
            '-4'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Vida');
        expect(attr!.value).toEqual(expect.objectContaining({ actual: 6 }));
    });

    it('BAR add em secao inexistente cria a secao com valor bruto (quirk: sem else)', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Inexistente',
            'Vida',
            '+3'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const section = result.attributes.sections.find(s => s.name === 'Inexistente');
        expect(section).toBeDefined();
    });

    it('BAR add em atributo inexistente retorna attribute-not-found', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Inexistente',
            '+3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'attribute-not-found' }]));
    });

    it('BAR add em atributo de outro tipo retorna type-mismatch', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Força',
            '+3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'type-mismatch' }]));
    });

    it('BAR com nome vazio retorna name-size', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            '',
            '+3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'name-size' }]));
    });

    it('BAR com valor invalido (SQL) retorna value-invalid', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Vida',
            'select * from users'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'value', code: 'value-invalid' }]));
    });

    it('BAR com posicao negativa retorna position-invalid', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Vida',
            '+3',
            -1
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'position', code: 'position-invalid' }]));
    });

    it('BAR add em atributo sem valor retorna type-mismatch', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Mana',
            value: null as unknown as string,
            position: 1,
            type: Attribute_Type.BAR
        });

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.BAR,
            'Atributos',
            'Mana',
            '+3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'type-mismatch' }]));
    });

    it('BAR sub em atributo sem valor retorna attribute-not-found', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Mana',
            value: null as unknown as string,
            position: 1,
            type: Attribute_Type.BAR
        });

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.BAR,
            'Atributos',
            'Mana',
            '-3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'attribute-not-found' }]));
    });

    it('BAR mod em atributo TEXT retorna type-mismatch', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Força',
            '10/20'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'type-mismatch' }]));
    });

    it.each([
        ['nome invalido (SQL)', 'Atributos', 'select * from users', '+3', { field: 'attribute', code: 'name-invalid' }],
        ['valor longo demais', 'Atributos', 'Vida', `+${'1'.repeat(1025)}`, { field: 'value', code: 'value-size' }],
        ['secao vazia', '', 'Vida', '+3', { field: 'section', code: 'section-size' }],
        ['secao invalida (SQL)', 'select * from users', 'Vida', '+3', { field: 'section', code: 'section-invalid' }]
    ])('BAR validacoes de campo: %s', async (_title, section, attribute, value, expected) => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            section,
            attribute,
            value
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([expected]));
    });

    it('BAR sub em atributo TEXT retorna type-mismatch', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Força',
            '-3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'type-mismatch' }]));
    });

    it('BAR sub em atributo inexistente retorna attribute-not-found', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Inexistente',
            '-3'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'attribute-not-found' }]));
    });

    it('BAR mod em atributo inexistente retorna attribute-not-found', async () => {
        const result = (await SheetServices.validateModification(
            barSheet(),
            Attribute_Type.BAR,
            'Atributos',
            'Inexistente',
            '10/20'
        )) as Array<{ field: string; code: string }>;

        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'attribute-not-found' }]));
    });

    it('BAR mod em atributo sem valor cria a barra', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Mana',
            value: null as unknown as string,
            position: 1,
            type: Attribute_Type.BAR
        });

        const result = (await SheetServices.validateModification(
            sheet,
            Attribute_Type.BAR,
            'Atributos',
            'Mana',
            '10/20'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        const attr = result.attributes.sections[0].attributes.find(a => a.name === 'Mana');
        expect(attr!.value).toEqual(expect.objectContaining({ actual: 10, max: 20 }));
    });

    it('editar existente com posicao atualiza a posicao', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.TEXT,
            'Atributos',
            'Força',
            '12',
            2
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes[0].position).toBe(2);
    });

    it('troca o tipo do atributo ao editar com outro component_type', async () => {
        const result = (await SheetServices.validateModification(
            baseSheet(),
            Attribute_Type.IMAGE,
            'Atributos',
            'Força',
            'https://exemplo.com/foto.png'
        )) as Sheet;

        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes[0].type).toBe(Attribute_Type.IMAGE);
    });
});

describe('validateDeleteSection / validateDeleteAttribute', () => {
    it('remove secao existente', async () => {
        const result = (await SheetServices.validateDeleteSection(baseSheet(), 'Atributos')) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections).toHaveLength(0);
    });

    it('secao inexistente retorna section-not-found', async () => {
        const result = (await SheetServices.validateDeleteSection(baseSheet(), 'Nada')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual([{ field: 'section', code: 'section-not-found' }]);
    });

    it('remover uma de duas secoes reposiciona a restante', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections.push({
            name: 'Perícias',
            position: 5,
            type: 0,
            attributes: [{ name: 'Furtividade', value: '3', position: 7, type: Attribute_Type.TEXT }]
        });

        const result = (await SheetServices.validateDeleteSection(sheet, 'Atributos')) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections).toHaveLength(1);
        expect(result.attributes.sections[0]).toEqual(expect.objectContaining({ name: 'Perícias', position: 0 }));
        expect(result.attributes.sections[0].attributes[0].position).toBe(0);
    });

    it('remove atributo existente e reordena posicoes', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Destreza',
            value: '8',
            position: 1,
            type: Attribute_Type.TEXT
        });

        const result = (await SheetServices.validateDeleteAttribute(sheet, 'Atributos', 'Força')) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes).toHaveLength(1);
        expect(result.attributes.sections[0].attributes[0]).toEqual(
            expect.objectContaining({ name: 'Destreza', position: 0 })
        );
    });

    it('secao inexistente retorna section-not-found', async () => {
        const result = (await SheetServices.validateDeleteAttribute(baseSheet(), 'Inexistente', 'Força')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual([{ field: 'section', code: 'section-not-found' }]);
    });

    it('atributo inexistente retorna attribute-not-found', async () => {
        const result = (await SheetServices.validateDeleteAttribute(baseSheet(), 'Atributos', 'Inexistente')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual([{ field: 'attribute', code: 'attribute-not-found' }]);
    });

    it('converte ficha legacy antes de deletar', async () => {
        const sheet = baseSheet();
        sheet.legacy = true;
        sheet.attributes = { Força: '10' } as unknown as Sheet['attributes'];

        const result = (await SheetServices.validateDeleteAttribute(sheet, 'Info 1', 'Força')) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes).toHaveLength(0);
    });
});

describe('validateRenameSection / validateRenameAttribute', () => {
    it('renomeia secao', async () => {
        const result = (await SheetServices.validateRenameSection(baseSheet(), 'Atributos', 'Perícias')) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].name).toBe('Perícias');
    });

    it('renomear para nome duplicado retorna name-duplicate', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections.push({ name: 'Perícias', position: 1, type: 0, attributes: [] });

        const result = (await SheetServices.validateRenameSection(sheet, 'Atributos', 'Perícias')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual([{ field: 'section', code: 'name-duplicate' }]);
    });

    it('renomeia atributo', async () => {
        const result = (await SheetServices.validateRenameAttribute(
            baseSheet(),
            'Atributos',
            'Força',
            'Destreza'
        )) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].attributes[0].name).toBe('Destreza');
    });

    it('secao inexistente retorna section-not-found', async () => {
        const result = (await SheetServices.validateRenameAttribute(
            baseSheet(),
            'Inexistente',
            'Força',
            'Destreza'
        )) as Array<{ field: string; code: string }>;
        expect(result).toEqual([{ field: 'section', code: 'section-not-found' }]);
    });

    it('atributo inexistente retorna attribute-not-found', async () => {
        const result = (await SheetServices.validateRenameAttribute(
            baseSheet(),
            'Atributos',
            'Inexistente',
            'Destreza'
        )) as Array<{ field: string; code: string }>;
        expect(result).toEqual([{ field: 'attribute', code: 'attribute-not-found' }]);
    });

    it('novo nome duplicado retorna name-duplicate', async () => {
        const sheet = baseSheet();
        sheet.attributes.sections[0].attributes.push({
            name: 'Destreza',
            value: '8',
            position: 1,
            type: Attribute_Type.TEXT
        });

        const result = (await SheetServices.validateRenameAttribute(sheet, 'Atributos', 'Força', 'Destreza')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual([{ field: 'attribute', code: 'name-duplicate' }]);
    });

    it('novo nome vazio retorna name-size', async () => {
        const result = (await SheetServices.validateRenameAttribute(baseSheet(), 'Atributos', 'Força', '')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'name-size' }]));
    });

    it('novo nome invalido (SQL) retorna name-invalid', async () => {
        const result = (await SheetServices.validateRenameAttribute(
            baseSheet(),
            'Atributos',
            'Força',
            'select * from users'
        )) as Array<{ field: string; code: string }>;
        expect(result).toEqual(expect.arrayContaining([{ field: 'attribute', code: 'name-invalid' }]));
    });

    it('secao invalida (SQL) retorna section-invalid', async () => {
        const result = (await SheetServices.validateRenameAttribute(
            baseSheet(),
            'select * from users',
            'Força',
            'Destreza'
        )) as Array<{ field: string; code: string }>;
        expect(result).toEqual(expect.arrayContaining([{ field: 'section', code: 'section-invalid' }]));
    });

    it('secao inexistente ao renomear secao retorna section-not-found', async () => {
        const result = (await SheetServices.validateRenameSection(baseSheet(), 'Inexistente', 'Nova')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual([{ field: 'section', code: 'section-not-found' }]);
    });

    it('novo nome de secao vazio retorna section-size', async () => {
        const result = (await SheetServices.validateRenameSection(baseSheet(), 'Atributos', '')) as Array<{
            field: string;
            code: string;
        }>;
        expect(result).toEqual(expect.arrayContaining([{ field: 'section', code: 'section-size' }]));
    });

    it('novo nome de secao invalido (SQL) retorna section-invalid', async () => {
        const result = (await SheetServices.validateRenameSection(
            baseSheet(),
            'Atributos',
            'select * from users'
        )) as Array<{ field: string; code: string }>;
        expect(result).toEqual(expect.arrayContaining([{ field: 'section', code: 'section-invalid' }]));
    });

    it('converte ficha legacy antes de renomear secao', async () => {
        const sheet = baseSheet();
        sheet.legacy = true;
        sheet.attributes = { Força: '10' } as unknown as Sheet['attributes'];

        const result = (await SheetServices.validateRenameSection(sheet, 'Info 1', 'Nova')) as Sheet;
        expect(Array.isArray(result)).toBe(false);
        expect(result.attributes.sections[0].name).toBe('Nova');
    });
});

describe('hash/verify password', () => {
    it('roundtrip bcrypt', async () => {
        const hash = await SheetServices.hashPasswordValue('minha-senha');
        expect(hash).toMatch(/^\$2[aby]\$/);
        await expect(
            SheetServices.verifySheetPassword({ sheet_password: hash } as unknown as Sheet, 'minha-senha')
        ).resolves.toBe(true);
        await expect(
            SheetServices.verifySheetPassword({ sheet_password: hash } as unknown as Sheet, 'errada')
        ).resolves.toBe(false);
    });

    it('fallback plaintext para senhas legadas', async () => {
        await expect(
            SheetServices.verifySheetPassword({ sheet_password: 'abc' } as unknown as Sheet, 'abc')
        ).resolves.toBe(true);
    });

    it('ficha nula retorna false sem throw', async () => {
        await expect(SheetServices.verifySheetPassword(null as unknown as Sheet, 'abc')).resolves.toBe(false);
    });
});

describe('convertLegacySheet', () => {
    it('converte mapa legado em secoes', () => {
        const sheet = baseSheet();
        sheet.legacy = true;
        sheet.attributes = { Força: '10', Nome: 'Bob' } as unknown as Sheet['attributes'];

        const converted = SheetServices.convertLegacySheet(sheet);
        expect(converted.legacy).toBe(false);
        expect(converted.attributes.sections[0].name).toBe('Info 1');
        expect(converted.attributes.sections[0].attributes).toHaveLength(2);
    });

    it('mantem ficha moderna intacta', () => {
        const sheet = baseSheet();
        expect(SheetServices.convertLegacySheet(sheet)).toBe(sheet);
    });

    it('attributes nulo reseta para secoes vazias', () => {
        const sheet = baseSheet();
        sheet.legacy = true;
        sheet.attributes = null as unknown as Sheet['attributes'];

        const converted = SheetServices.convertLegacySheet(sheet);
        expect(converted.legacy).toBe(false);
        expect(converted.attributes).toEqual({ sections: [] });
    });

    it('ficha legacy ja com secoes so desmarca legacy', () => {
        const sheet = baseSheet();
        sheet.legacy = true;

        const converted = SheetServices.convertLegacySheet(sheet);
        expect(converted.legacy).toBe(false);
        expect(converted.attributes.sections).toHaveLength(1);
    });

    it('mais de 25 atributos geram varias secoes Info', () => {
        const sheet = baseSheet();
        sheet.legacy = true;
        const raw: Record<string, string> = {};
        for (let i = 0; i < 30; i++) {
            raw[`attr${i}`] = `${i}`;
        }
        sheet.attributes = raw as unknown as Sheet['attributes'];

        const converted = SheetServices.convertLegacySheet(sheet);
        const sections = converted.attributes.sections as unknown as { name: string }[];
        expect(sections).toHaveLength(2);
        expect(sections[0].name).toBe('Info 1');
        expect(sections[1].name).toBe('Info 2');
    });
});
