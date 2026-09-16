import { InteractionResponseType } from 'discord-interactions';

// Mocks em test/mocks/{rest,database}.ts.
jest.mock('../../../src/configs/rest', () => require('../../mocks/rest'));
jest.mock('../../../src/configs/database', () => require('../../mocks/database'));
// Registro de comandos sintético: exercita os ramos de tipos de argumento
// (INTEGER/USER/ATTACHMENT), context menu (type 3), choices e autocomplete,
// que o registro real não possui.
//
// A entrada 'reloadslashs' delega para a implementação real de forma LAZY
// (requireActual no momento da chamada): importar o módulo real no topo
// causaria TDZ, pois ele importa '..' e executaria esta factory antes de
// o binding existir.
jest.mock('../../../src/commands', () => {
    const stringArgs = (suffix: string) => ({
        'en-us': [
            { name: 'count', description: `A count ${suffix}`, type: 'INTEGER', required: false, autocomplete: false },
            { name: 'user', description: `A user ${suffix}`, type: 'USER', required: false, autocomplete: false },
            {
                name: 'file',
                description: `A file ${suffix}`,
                type: 'ATTACHMENT',
                required: false,
                autocomplete: false
            },
            {
                name: 'mode',
                description: `Mode ${suffix}`,
                type: 'STRING',
                required: true,
                autocomplete: false,
                choices: [
                    { name: 'Fast', return: 'fast' },
                    { name: 'Slow', return: 'slow' }
                ]
            },
            { name: 'query', description: `Query ${suffix}`, type: 'STRING', required: false, autocomplete: true }
        ],
        'pt-br': [
            {
                name: 'quantidade',
                description: `Uma quantidade ${suffix}`,
                type: 'INTEGER',
                required: false,
                autocomplete: false
            },
            {
                name: 'usuario',
                description: `Um usuário ${suffix}`,
                type: 'USER',
                required: false,
                autocomplete: false
            },
            {
                name: 'arquivo',
                description: `Um arquivo ${suffix}`,
                type: 'ATTACHMENT',
                required: false,
                autocomplete: false
            },
            {
                name: 'modo',
                description: `Modo ${suffix}`,
                type: 'STRING',
                required: true,
                autocomplete: false,
                choices: [
                    { name: 'Rápido', return: 'fast' },
                    { name: 'Lento', return: 'slow' }
                ]
            },
            { name: 'busca', description: `Busca ${suffix}`, type: 'STRING', required: false, autocomplete: true }
        ]
    });

    const fakeFull = {
        ownerOnly: false,
        type: 1,
        commandNames: { 'en-us': 'fakefull', 'pt-br': 'fakefull' },
        fullNames: { 'en-us': 'Fake Full', 'pt-br': 'Fake Full' },
        descriptions: { 'en-us': 'Full fake command', 'pt-br': 'Comando falso completo' },
        arguments: stringArgs('full')
    };
    const fakeOwnerFull = {
        ...fakeFull,
        ownerOnly: true,
        commandNames: { 'en-us': 'fakeownerfull', 'pt-br': 'fakeownerfull' }
    };
    const fakeCtx = {
        ownerOnly: false,
        type: 3,
        commandNames: { 'en-us': 'fakectx', 'pt-br': 'fakectx' },
        fullNames: { 'en-us': 'Fake Ctx', 'pt-br': 'Fake Ctx' },
        descriptions: { 'en-us': 'Fake ctx', 'pt-br': 'Fake ctx' }
    };
    const fakeCtxOwner = {
        ...fakeCtx,
        ownerOnly: true,
        commandNames: { 'en-us': 'fakectxowner', 'pt-br': 'fakectxowner' }
    };

    const map = new Map<string, unknown>();
    map.set('reloadslashs', {
        ownerOnly: true,
        type: 1,
        category: 'OWNER_ONLY',
        commandNames: { 'en-us': 'reloadslashs', 'pt-br': 'reloadslashs' },
        fullNames: { 'en-us': 'Reload Slashs', 'pt-br': 'Reload Slashs' },
        descriptions: { 'en-us': 'Reloads the bot commands', 'pt-br': 'Recarrega os comandos do bot' },
        run: async (int: unknown, language: unknown) => {
            const real = jest.requireActual('../../../src/commands/owner-only/reload-commands').default as {
                run: (i: unknown, l: unknown) => Promise<unknown>;
            };
            return real.run(int, language);
        }
    });
    map.set('fakefull', fakeFull);
    map.set('fakeownerfull', fakeOwnerFull);
    map.set('fakectx', fakeCtx);
    map.set('fakectxowner', fakeCtxOwner);
    return { __esModule: true, default: map };
});

import app, { ready } from '../../../src/app';
import rest from '../../../src/configs/rest';
import db from '../../../src/configs/database';
import {
    MockDb,
    MockRest,
    lastWebhookBody,
    setupDefaultDbMocks,
    setupDefaultRestMocks
} from '../../helpers/mock-factories';
import { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } from '../../helpers/interaction-factory';

const mockRest = rest as unknown as MockRest;
const mockDb = db as unknown as MockDb;
const OWNER_ID = process.env.OWNER_ID!;

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(mockRest);
    setupDefaultDbMocks(mockDb);
});

describe('/reloadslashs com todos os tipos de argumento', () => {
    it('constrói comandos globais com INTEGER/USER/ATTACHMENT/choices/autocomplete', async () => {
        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({ name: 'reloadslashs', userId: OWNER_ID })
        );

        expect(res.status).toBe(200);
        expect(res.body.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
        expect(mockRest.put).toHaveBeenCalledTimes(2);

        // corpo global serializado contém os tipos numéricos das opções
        const globalBody = mockRest.put.mock.calls[0][1] as { body: { toJSON?: () => unknown }[] };
        const flat = JSON.stringify(globalBody.body.map(c => (c && typeof c.toJSON === 'function' ? c.toJSON() : c)));
        expect(flat).toContain('"type":4'); // INTEGER
        expect(flat).toContain('"type":6'); // USER
        expect(flat).toContain('"type":11'); // ATTACHMENT
        expect(flat).toContain('fakefull');

        const ownerBody = mockRest.put.mock.calls[1][1] as { body: { toJSON?: () => unknown }[] };
        const flatOwner = JSON.stringify(
            ownerBody.body.map(c => (c && typeof c.toJSON === 'function' ? c.toJSON() : c))
        );
        expect(flatOwner).toContain('fakeownerfull');
        expect(flatOwner).toContain('fakectxowner');

        expect(lastWebhookBody(mockRest)).toEqual(expect.objectContaining({ content: 'Comandos recarregados' }));
    });
});
