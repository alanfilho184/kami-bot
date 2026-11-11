const { InteractionResponseType } = require('discord-interactions');

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));

const appModule = require('../../../src/app');
const app = appModule.default;
const { ready } = appModule;
const rest = require('../../../src/configs/rest').default;
const db = require('../../../src/configs/database').default;
const sheetNameCache = require('../../../src/resources/cache/sheet-name.cache').default;
const {
    fakeSheetRow,
    fakeUserRow,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} = require('../../helpers/mock-factories');
const {
    buildAutocompleteInteraction,
    buildCommandInteraction,
    postCommandAndWaitReply,
    postSignedInteraction,
    waitAppReady
} = require('../../helpers/interaction-factory');
const { createSheetEmbed } = require('../../../src/commands/sheet/sheet-send');

const mockRest = rest;
const mockDb = db;

const sectionedAttributes = {
    sections: [
        {
            name: 'Atributos',
            position: 0,
            type: 0,
            attributes: [{ name: 'Força', value: '10', position: 0, type: 0 }]
        }
    ]
};

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/sheet_send', () => {
    it('envia a ficha em embeds', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('adiciona link no author quando o dono tem conta no site', async () => {
        setupDefaultDbMocks(mockDb, {
            email: 'lyra@example.com',
            password: '$2b$12$hash-de-teste'
        });
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        const firstEmbed = lastWebhookBody(mockRest).embeds?.[0];

        expect(firstEmbed.author).toEqual(
            expect.objectContaining({
                url: 'https://kamiapp.com.br/1/ficha/Test%20Sheet?id=10'
            })
        );
    });

    it('ficha inexistente responde sheet-not-found', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(null);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Inexistente' }]
            })
        );

        expect(lastWebhookBody(mockRest)).toEqual(
            expect.objectContaining({ content: expect.stringContaining('Inexistente') })
        );
    });

    it('opcao sync ativa mensagem sincronizada (irt)', async () => {
        const sheet = fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes });
        mockDb.sheets.findFirst.mockResolvedValue(sheet);
        mockDb.sheets.findUnique.mockResolvedValue(sheet);
        mockDb.irt_sheets.count.mockResolvedValue(0);

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'options', type: 3, value: 'sync' }
                ]
            })
        );

        expect(res.status).toBe(200);
        expect(mockDb.irt_sheets.create).toHaveBeenCalled();
        expect(mockDb.logs.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action_target: 'sheet_send', status: 'SUCCESS' })
            })
        );
    });

    it('bloqueia sync em DM e envia a ficha sem sincronização', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                inDM: true,
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'options', type: 3, value: 'sync' }
                ]
            })
        );

        const body = lastWebhookBody(mockRest);

        expect(res.status).toBe(200);
        expect(mockDb.irt_sheets.create).not.toHaveBeenCalled();
        expect(body.content).toContain('só pode ser usada em servidores');
        expect(body.embeds?.length).toBeGreaterThan(0);
    });

    it('bloqueia sync quando o app está instalado apenas no usuário, mesmo em servidor', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );

        const interaction = buildCommandInteraction({
            name: 'sheet_send',
            options: [
                { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                { name: 'options', type: 3, value: 'sync' }
            ]
        });

        interaction.authorizing_integration_owners = { 1: interaction.member.user.id };

        const res = await postCommandAndWaitReply(app, interaction);
        const body = lastWebhookBody(mockRest);

        expect(res.status).toBe(200);
        expect(mockDb.irt_sheets.create).not.toHaveBeenCalled();
        expect(body.content).toContain('só pode ser usada em servidores');
        expect(body.embeds?.length).toBeGreaterThan(0);
    });

    it('limite de 3 sincronizadas para nao-premium', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, attributes: sectionedAttributes })
        );
        mockDb.irt_sheets.count.mockResolvedValue(3);

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [
                    { name: 'sheet_name', type: 3, value: 'Test Sheet' },
                    { name: 'options', type: 3, value: 'sync' }
                ]
            })
        );

        expect(mockDb.irt_sheets.create).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: expect.any(String) }));
    });

    it('renderiza todos os tipos de atributo', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({
                id: 10,
                user_id: 1,
                attributes: {
                    sections: [
                        {
                            name: 'Tudo',
                            position: 0,
                            type: 0,
                            attributes: [
                                { name: 'Texto', value: 'algum texto', position: 0, type: 0 },
                                { name: 'Numero', value: '42', position: 1, type: 1 },
                                { name: 'Imagem', value: 'https://exemplo.com/foto.png', position: 2, type: 2 },
                                {
                                    name: 'Lista',
                                    value: { items: [{ name: 'Poção', quantity: 2 }] },
                                    position: 3,
                                    type: 3
                                },
                                {
                                    name: 'Vida',
                                    value: { actual: 10, max: 20, min: 0, step: 1 },
                                    position: 4,
                                    type: 4
                                }
                            ]
                        }
                    ]
                }
            })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        const body = lastWebhookBody(mockRest);
        expect(body.embeds?.length).toBeGreaterThan(0);
        const flat = JSON.stringify(body.embeds);
        for (const expected of ['Texto', 'Numero', 'Lista', 'Vida']) {
            expect(flat).toContain(expected);
        }
        // IMAGE vira thumbnail do embed, não field
        expect(flat).toContain('https://exemplo.com/foto.png');
    });

    it('ignora thumbnail com URL inválida sem derrubar o embed', () => {
        const sheet = fakeSheetRow({
            id: 10,
            user_id: 1,
            attributes: {
                sections: [
                    {
                        name: 'Info',
                        position: 0,
                        type: 0,
                        attributes: [
                            { name: 'Texto', value: 'ok', position: 0, type: 0 },
                            { name: 'Imagem', value: 'javascript:alert(1)', position: 1, type: 2 }
                        ]
                    }
                ]
            }
        });

        const [embed] = createSheetEmbed(sheet, 'pt-br').map(item => item.toJSON());

        expect(embed.thumbnail).toBeUndefined();
        expect(JSON.stringify(embed)).not.toContain('javascript:');
        expect(embed.fields.map(field => field.name)).toContain('Texto');
        expect(embed.fields.map(field => field.name)).toContain('Exibição limitada no Discord');
    });

    it('galeria ignora imagens com URL inválida', () => {
        const sheet = fakeSheetRow({
            id: 10,
            user_id: 1,
            attributes: {
                sections: [
                    {
                        name: 'Galeria',
                        position: 0,
                        type: 4,
                        attributes: [
                            { name: 'Boa', value: 'https://exemplo.com/ok.png', position: 0, type: 2 },
                            { name: 'Ruim', value: 'não-é-url', position: 1, type: 2 }
                        ]
                    }
                ]
            }
        });

        const [embed] = createSheetEmbed(sheet, 'pt-br').map(item => item.toJSON());

        expect(embed.thumbnail?.url).toBe('https://exemplo.com/ok.png');
        expect(embed.fields[0].value).toContain('[Boa](https://exemplo.com/ok.png)');
        expect(embed.fields[0].value).not.toContain('Ruim');
    });

    it('ficha legacy é convertida no embed', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({ id: 10, user_id: 1, legacy: true, attributes: { Força: '10', Nome: 'Bob' } })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('não envia ficha complexa e encaminha para o site', async () => {
        const attributes = Array.from({ length: 26 }, (_, index) => ({
            name: `Atributo ${index}`,
            value: 'valor',
            position: index,
            type: 0
        }));

        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({
                id: 10,
                user_id: 1,
                attributes: {
                    sections: [
                        {
                            name: 'Muitos',
                            position: 0,
                            type: 0,
                            attributes
                        }
                    ]
                }
            })
        );

        await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(mockDb.irt_sheets.create).not.toHaveBeenCalled();
        expect(lastWebhookBody(mockRest).content).toContain('complexa demais');
        expect(lastWebhookBody(mockRest).content).toContain('kamiapp.com.br');
    });

    it('atributo com overflow gera embed de erro sem quebrar', async () => {
        mockDb.sheets.findFirst.mockResolvedValue(
            fakeSheetRow({
                id: 10,
                user_id: 1,
                attributes: {
                    sections: [
                        {
                            name: 'Tudo',
                            position: 0,
                            type: 0,
                            attributes: [{ name: 'x'.repeat(300), value: 'v', position: 0, type: 0 }]
                        }
                    ]
                }
            })
        );

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'sheet_send',
                options: [{ name: 'sheet_name', type: 3, value: 'Test Sheet' }]
            })
        );

        expect(res.status).toBe(200);
        expect(lastWebhookBody(mockRest).embeds?.length).toBeGreaterThan(0);
    });

    it('autocomplete de sheet_name sugere nomes do cache', async () => {
        sheetNameCache.add(1, 'Test Sheet');

        const res = await postSignedInteraction(
            app,
            buildAutocompleteInteraction({
                name: 'sheet_send',
                focusedOption: { name: 'sheet_name', type: 3, value: 'Test' }
            })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(8);
        expect(res.body.data.choices.length).toBeGreaterThan(0);
    });

    it('renderiza cabeçalho, status, galeria, tabela e descrição do modelo novo', () => {
        const sheet = fakeSheetRow({
            id: 10,
            user_id: 1,
            sheet_name: 'Lyra Voss',
            is_public: true,
            user: fakeUserRow({
                id: 1,
                username: 'Lyra Voss',
                email: 'lyra@example.com',
                has_site_account: true
            }),
            attributes: {
                sections: [
                    {
                        name: 'Identidade',
                        position: 0,
                        type: 2,
                        attributes: [
                            { name: 'Nome', value: 'Lyra Voss', position: 0, type: 0 },
                            { name: 'Resumo', value: 'Cartógrafa de ruínas', position: 1, type: 0 },
                            {
                                name: 'Retrato',
                                value: 'https://exemplo.com/lyra.png',
                                position: 2,
                                type: 2
                            },
                            {
                                name: 'Descrição',
                                value: 'Lyra mapeia ruínas que não aparecem em nenhum mapa.',
                                position: 3,
                                type: 0
                            }
                        ]
                    },
                    {
                        name: 'Condição',
                        position: 1,
                        type: 3,
                        attributes: [
                            {
                                name: 'Estado',
                                position: 0,
                                type: 5,
                                value: {
                                    items: [
                                        {
                                            id: 'ferido',
                                            name: 'Ferido',
                                            color: '#ff0000',
                                            blink: false,
                                            active: true
                                        },
                                        {
                                            id: 'exausto',
                                            name: 'Exausto',
                                            color: '#ffaa00',
                                            blink: false,
                                            active: false
                                        }
                                    ]
                                }
                            }
                        ]
                    },
                    {
                        name: 'Galeria',
                        position: 2,
                        type: 4,
                        attributes: [
                            {
                                name: 'Foto 1',
                                value: 'https://exemplo.com/foto1.png',
                                position: 0,
                                type: 2
                            },
                            {
                                name: 'Foto 2',
                                value: 'https://exemplo.com/foto2.png',
                                position: 1,
                                type: 2
                            }
                        ]
                    },
                    {
                        name: 'Perícias',
                        position: 3,
                        type: 5,
                        attributes: [
                            {
                                name: 'Tabela',
                                position: 0,
                                type: 6,
                                value: {
                                    columns: ['Perícia', 'Bônus'],
                                    rows: [
                                        ['Investigação', '+5'],
                                        ['Furtividade', '+3']
                                    ]
                                }
                            }
                        ]
                    },
                    {
                        name: 'Anotações',
                        position: 4,
                        type: 1,
                        attributes: [{ name: 'Texto', value: 'Uma nota.', position: 0, type: 0 }]
                    }
                ]
            },
            sheet_layout: {
                sections: {
                    Identidade: {
                        columns: 12,
                        header: {
                            title: 'Nome',
                            subtitle: 'Resumo',
                            image: 'Retrato'
                        },
                        attributes: {
                            Descrição: { span: 12, rows: 1 }
                        }
                    }
                }
            }
        });

        const [header, status, gallery, table, notes] = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(header.author).toEqual(
            expect.objectContaining({
                name: 'Lyra Voss',
                url: 'https://kamiapp.com.br/1/ficha/Lyra%20Voss?id=10'
            })
        );
        expect(header.description).toBe('Cartógrafa de ruínas');
        expect(header.thumbnail?.url).toBe('https://exemplo.com/lyra.png');
        expect(header.fields.map(field => field.name)).toContain('Descrição');
        expect(header.fields.map(field => field.name)).not.toContain('Nome');
        expect(header.fields.map(field => field.name)).not.toContain('Resumo');
        expect(header.fields.map(field => field.name)).not.toContain('Retrato');

        expect(status.fields[0].name).toBe('Estado');
        expect(status.fields[0].value).toContain('Ferido');
        expect(status.fields[0].value).toContain('Exausto');

        expect(gallery.thumbnail?.url).toBe('https://exemplo.com/foto1.png');
        expect(gallery.fields[0].name).toBe('Imagens');
        expect(gallery.fields[0].value).toContain('[Foto 1](https://exemplo.com/foto1.png)');
        expect(gallery.fields[0].value).toContain('[Foto 2](https://exemplo.com/foto2.png)');

        expect(table.fields[0].name).toBe('Tabela');
        expect(table.fields[0].value).toContain('Perícia | Bônus');
        expect(table.fields[0].value).toContain('Investigação | +5');
        expect(notes.description).toBe('Uma nota.');
    });

    it('não cria author com link quando o dono não tem conta no site', () => {
        const sheet = fakeSheetRow({
            id: 10,
            user_id: 1,
            attributes: {
                sections: [
                    {
                        name: 'Info',
                        position: 0,
                        type: 0,
                        attributes: [{ name: 'Força', value: '10', position: 0, type: 0 }]
                    }
                ]
            },
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false })
        });

        const [first] = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(first.author).toBeUndefined();
    });

    it('avisa e reduz tabela que não cabe no embed', () => {
        const sheet = fakeSheetRow({
            attributes: {
                sections: [
                    {
                        name: 'Tabela',
                        position: 0,
                        type: 5,
                        attributes: [
                            {
                                name: 'Tabela',
                                position: 0,
                                type: 6,
                                value: {
                                    columns: ['Perícia', 'Bônus'],
                                    rows: Array.from({ length: 100 }, (_, index) => [`Perícia ${index}`, '+1'])
                                }
                            }
                        ]
                    }
                ]
            },
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false })
        });

        const [first] = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());
        const fields = first.fields.map(field => field.name);

        expect(fields).toContain('Exibição limitada no Discord');
        expect(JSON.stringify(first)).toContain('tabela foi reduzida');
    });

    it('cria fallback para ficha sem seções', () => {
        const sheet = fakeSheetRow({
            attributes: { sections: [] },
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false })
        });

        const [first] = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(first.title).toContain('Test Sheet');
        expect(first.description).toContain('ainda não tem seções');
    });

    it('faz fallback do cabeçalho quando não há sheet_layout', () => {
        const sheet = fakeSheetRow({
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false }),
            sheet_layout: null,
            attributes: {
                sections: [
                    {
                        name: 'Identidade',
                        position: 0,
                        type: 2,
                        attributes: [
                            { name: 'Nome', value: 'Lyra', position: 0, type: 0 },
                            {
                                name: 'Retrato',
                                value: 'https://exemplo.com/lyra.png',
                                position: 1,
                                type: 2
                            }
                        ]
                    }
                ]
            }
        });

        const [first] = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(first.fields.map(field => field.name)).toContain('Nome');
        expect(first.thumbnail?.url).toBe('https://exemplo.com/lyra.png');
    });

    it('explica seções especiais vazias', () => {
        const sheet = fakeSheetRow({
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false }),
            attributes: {
                sections: [
                    { name: 'Condição', position: 0, type: 3, attributes: [] },
                    { name: 'Galeria', position: 1, type: 4, attributes: [] },
                    { name: 'Tabela', position: 2, type: 5, attributes: [] }
                ]
            }
        });

        const embeds = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(embeds).toHaveLength(3);
        expect(embeds[0].description).toContain('não tem conteúdo');
        expect(embeds[1].description).toContain('não tem conteúdo');
        expect(embeds[2].description).toContain('não tem conteúdo');
    });

    it('lista links da galeria e avisa quando há imagens demais', () => {
        const images = Array.from({ length: 60 }, (_, index) => ({
            name: `Imagem ${index} com um nome razoavelmente longo`,
            value: `https://exemplo.com/imagem-${index}.png`,
            position: index,
            type: 2
        }));
        const sheet = fakeSheetRow({
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false }),
            attributes: {
                sections: [{ name: 'Galeria', position: 0, type: 4, attributes: images }]
            }
        });

        const [first] = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(first.fields.map(field => field.name)).toContain('Exibição limitada no Discord');
        expect(JSON.stringify(first)).toContain('imagem(ns) adicional(is)');
    });

    it('limita a ficha a 10 embeds e resume as seções omitidas', () => {
        const sections = Array.from({ length: 12 }, (_, index) => ({
            name: `Seção ${index}`,
            position: index,
            type: 0,
            attributes: [{ name: 'Texto', value: `Valor ${index}`, position: 0, type: 0 }]
        }));
        const sheet = fakeSheetRow({
            user: fakeUserRow({ id: 1, email: null, password: null, has_site_account: false }),
            attributes: { sections }
        });

        const embeds = createSheetEmbed(sheet, 'pt-br').map(embed => embed.toJSON());

        expect(embeds).toHaveLength(10);
        expect(embeds[9].title).toBe('Mais seções');
        expect(embeds[9].description).toContain('3');
    });
});
