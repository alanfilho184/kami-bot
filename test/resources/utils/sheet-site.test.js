const {
    buildSheetSiteUrl,
    isSpecialSection,
    renameLayoutSection,
    renameLayoutAttribute,
    removeLayoutSection,
    removeLayoutAttribute
} = require('../../../src/resources/utils/sheet-site');

const makeSheet = overrides => ({
    id: 10,
    user_id: 42,
    sheet_name: 'Lyra Voss',
    sheet_password: null,
    is_public: true,
    legacy: false,
    last_use: new Date(),
    attributes: { sections: [] },
    sheet_layout: {
        sections: {
            Info: {
                columns: 12,
                attributes: {
                    Força: { span: 6, rows: 1 }
                },
                header: {
                    title: 'Nome',
                    subtitle: 'Resumo',
                    image: 'Retrato'
                }
            }
        }
    },
    ...overrides
});

describe('sheet-site', () => {
    it('monta a URL canônica com id e nome codificado', () => {
        expect(buildSheetSiteUrl(makeSheet())).toBe('https://kamiapp.com.br/42/ficha/Lyra%20Voss?id=10');
    });

    it('identifica seções especiais', () => {
        expect(isSpecialSection({ type: 0 })).toBe(false);
        expect(isSpecialSection({ type: 1 })).toBe(true);
        expect(isSpecialSection({ type: 2 })).toBe(true);
        expect(isSpecialSection({ type: 3 })).toBe(true);
        expect(isSpecialSection({ type: 4 })).toBe(true);
        expect(isSpecialSection({ type: 5 })).toBe(true);
    });

    it('renomeia a chave da seção no layout', () => {
        const sheet = makeSheet();

        renameLayoutSection(sheet, 'Info', 'Atributos');

        expect(sheet.sheet_layout.sections.Atributos).toBeDefined();
        expect(sheet.sheet_layout.sections.Info).toBeUndefined();
    });

    it('remove a seção do layout', () => {
        const sheet = makeSheet();

        removeLayoutSection(sheet, 'Info');

        expect(sheet.sheet_layout.sections.Info).toBeUndefined();
    });

    it('renomeia atributo e referências de cabeçalho', () => {
        const sheet = makeSheet();

        renameLayoutAttribute(sheet, 'Info', 'Força', 'Poder');
        renameLayoutAttribute(sheet, 'Info', 'Nome', 'Título');

        expect(sheet.sheet_layout.sections.Info.attributes.Poder).toEqual({ span: 6, rows: 1 });
        expect(sheet.sheet_layout.sections.Info.attributes.Força).toBeUndefined();
        expect(sheet.sheet_layout.sections.Info.header.title).toBe('Título');
    });

    it('remove atributo e referência de cabeçalho', () => {
        const sheet = makeSheet();

        removeLayoutAttribute(sheet, 'Info', 'Força');
        removeLayoutAttribute(sheet, 'Info', 'Retrato');

        expect(sheet.sheet_layout.sections.Info.attributes.Força).toBeUndefined();
        expect(sheet.sheet_layout.sections.Info.header.image).toBeUndefined();
    });
});
