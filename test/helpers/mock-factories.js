// =============================================================================
// Helpers de mock para os testes (NÃO usar dentro da factory do jest.mock).
//
// Por que não usar estas funções dentro de `jest.mock(path, factory)`?
// O Jest faz hoist do jest.mock para o topo do arquivo e proíbe referenciar
// variáveis out-of-scope na factory (só permite nomes prefixados com `mock`).
// Padrão correto em cada arquivo de teste (mocks em test/mocks):
//
//   jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
//   jest.mock('../../src/configs/database', () => require('../mocks/database'));
//
// E então, no beforeEach, usar os helpers abaixo para configurar defaults:
//   const rest = require('../../src/configs/rest');
//   const db = require('../../src/configs/database');
//   setupDefaultRestMocks(rest); setupDefaultDbMocks(db);
// =============================================================================

/** Configura respostas padrão do REST mockado (Discord). */
function setupDefaultRestMocks(mockRest) {
    mockRest.get.mockResolvedValue({ url: 'wss://gateway.invalid', shards: 1 });
    mockRest.post.mockResolvedValue({ id: '999999999999999999' });
    mockRest.patch.mockResolvedValue({ id: '999999999999999999' });
    mockRest.put.mockResolvedValue({});
    mockRest.delete.mockResolvedValue({});
}

/**
 * Retorna o `body` da última chamada `rest.patch(webhookMessage(...))`
 * normalizado para JSON puro.
 *
 * Motivo: os comandos passam instâncias de EmbedBuilder/ButtonBuilder/
 * ActionRowBuilder para `int.reply()`, e essas classes guardam os campos
 * dentro de `.data` (ex.: `embed.title` é undefined, `embed.data.title`
 * tem o valor). O `toJSON()` achata para o formato real enviado ao Discord.
 */
function lastWebhookBody(mockRest) {
    const calls = mockRest.patch.mock.calls;
    const last = calls[calls.length - 1];
    const body = last?.[1]?.body ?? {};
    return normalizeBuilders(body);
}

function normalizeBuilders(value) {
    if (Array.isArray(value)) {
        return value.map(normalizeBuilders);
    }
    if (value && typeof value === 'object') {
        if (typeof value.toJSON === 'function') {
            try {
                return normalizeBuilders(value.toJSON());
            } catch {
                // cai para normalização por chaves abaixo
            }
        }
        const out = {};
        for (const key of Object.keys(value)) {
            out[key] = normalizeBuilders(value[key]);
        }
        return out;
    }
    return value;
}

/** Usuário fake pronto para ser retornado por db.users.findUnique/create. */
function fakeUserRow(overrides = {}) {
    return {
        id: 1,
        discord_id: '222222222222222222',
        username: 'Tester',
        email: null,
        avatar: 'default-avatar.png',
        password: null,
        is_beta: false,
        is_premium: false,
        last_use: new Date(),
        user_config: [],
        ...overrides
    };
}

/** Ficha fake no formato bruto do Prisma (toSheet converte). */
function fakeSheetRow(overrides = {}) {
    return {
        id: 10,
        user_id: 1,
        sheet_name: 'Test Sheet',
        sheet_password: null,
        is_public: true,
        legacy: false,
        attributes: { sections: [] },
        last_use: new Date(),
        ...overrides
    };
}

/** Configura respostas padrão do Prisma mockado. */
function setupDefaultDbMocks(mockDb, userOverrides = {}) {
    const fakeUser = fakeUserRow(userOverrides);

    mockDb.users.findUnique.mockResolvedValue(fakeUser);
    mockDb.users.findFirst.mockResolvedValue(fakeUser);
    mockDb.users.create.mockResolvedValue(fakeUser);
    mockDb.users.update.mockResolvedValue(fakeUser);

    mockDb.users_config.upsert.mockResolvedValue({});
    mockDb.users_config.findMany.mockResolvedValue([]);
    mockDb.users_config.findFirst.mockResolvedValue(null);

    mockDb.logs.create.mockResolvedValue({ id: 1 });
    mockDb.logs.count.mockResolvedValue(0);

    mockDb.sheets.findMany.mockResolvedValue([]);
    mockDb.sheets.findFirst.mockResolvedValue(null);
    mockDb.sheets.findUnique.mockResolvedValue(null);
    mockDb.sheets.count.mockResolvedValue(0);
    mockDb.sheets.create.mockImplementation(async (args) =>
        fakeSheetRow({ ...(args?.data ?? {}) })
    );
    mockDb.sheets.update.mockImplementation(async (args) =>
        fakeSheetRow({ ...(args?.data ?? {}) })
    );
    mockDb.sheets.delete.mockResolvedValue(fakeSheetRow());

    mockDb.irt_sheets.findMany.mockResolvedValue([]);
    mockDb.irt_sheets.findFirst.mockResolvedValue(null);
    mockDb.irt_sheets.count.mockResolvedValue(0);
    mockDb.irt_sheets.create.mockResolvedValue({ id: 1 });
    mockDb.irt_sheets.deleteMany.mockResolvedValue({ count: 0 });

    mockDb.resources.findUnique.mockResolvedValue({ data: ['Insanity A', 'Insanity B', 'Insanity C'] });

    mockDb.announcement.findMany.mockResolvedValue([]);
    mockDb.announcements_seen.findMany.mockResolvedValue([]);
    mockDb.announcements_seen.upsert.mockResolvedValue({});

    mockDb.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockDb.$queryRawUnsafe.mockResolvedValue([
        {
            total_users: 1,
            total_active_users: 1,
            total_sheets_created: 1,
            total_commands: 1,
            total_components: 1,
            total_commands_today: 1,
            total_components_today: 1,
            total_commands_month: 1,
            total_components_month: 1,
            total_commands_prev_month: 1,
            total_components_prev_month: 1
        }
    ]);
    mockDb.$connect.mockResolvedValue(undefined);
}

/**
 * Aguarda até que o mock receba ao menos `minCalls` chamadas (poll).
 *
 * Motivo: a rota responde o acknowledge (HTTP 200) ANTES de executar o
 * comando; o `reply` (rest.patch) acontece depois. Comandos com I/O real
 * (ex.: bcrypt em configure-password/sheet_view) terminam depois que o
 * supertest já resolveu — sem espera, a asserção vê 0 chamadas (flaky).
 */
async function waitForCall(mockFn, minCalls = 1, timeoutMs = 10000) {
    const start = Date.now();
    while (mockFn.mock.calls.length < minCalls) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out waiting for ${minCalls} call(s)`);
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
}

/**
 * Extrai o custom_id completo de uma ação `$a$...` do corpo normalizado
 * (via lastWebhookBody) de um reply. Usado para "clicar" nos botões de
 * confirmação/cancelamento que os comandos registram com UUID aleatório.
 */
function findActionId(body, prefix) {
    const ids = [];
    const walk = (value) => {
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (value && typeof value === 'object') {
            for (const [key, val] of Object.entries(value)) {
                if (key === 'custom_id' && typeof val === 'string' && val.includes(prefix)) {
                    ids.push(val);
                } else {
                    walk(val);
                }
            }
        }
    };
    walk(body);
    if (ids.length === 0) {
        throw new Error(`Action "${prefix}" not found in reply body`);
    }
    return ids[0];
}

module.exports = {
    setupDefaultRestMocks,
    lastWebhookBody,
    fakeUserRow,
    fakeSheetRow,
    setupDefaultDbMocks,
    waitForCall,
    findActionId
};
