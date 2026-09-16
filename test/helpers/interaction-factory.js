const nacl = require('tweetnacl');
const request = require('supertest');
const { InteractionType } = require('discord-interactions');
const { waitForCall } = require('./mock-factories');

// =============================================================================
// Factory de payloads de interação do Discord para testes.
//
// - Gera payloads válidos de APPLICATION_COMMAND, MESSAGE_COMPONENT,
//   MODAL_SUBMIT, APPLICATION_COMMAND_AUTOCOMPLETE e PING;
// - Assina o payload EXATAMENTE como o Discord faz
//   (ED25519 sobre `timestamp + body`, em hex);
// - Envia a requisição assinada via supertest.
//
// O par de chaves é criado em test/helpers/setup.js (setupFiles).
// =============================================================================

function getTestKeyPair() {
    return globalThis.__TEST_KEY_PAIR__;
}

const DISCORD_EPOCH = 1420070400000;

/** Gera um snowflake plausível (string numérica) para ids de interação. */
function snowflake(date = new Date()) {
    return ((BigInt(date.getTime() - DISCORD_EPOCH) << 22n) | 42n).toString();
}

/**
 * Assina o corpo da requisição exatamente como o Discord:
 * signature = ED25519(`timestamp + body`), em hex.
 */
function sign(body, timestamp) {
    // Uint8Array.toString('hex') NÃO gera hex — converter via Buffer.
    return Buffer.from(nacl.sign.detached(Buffer.from(timestamp + body), getTestKeyPair().secretKey)).toString('hex');
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaults = {
    applicationId: process.env.CLIENT_ID ?? '111111111111111111',
    guildId: '333333333333333333',
    channelId: '444444444444444444',
    userId: '222222222222222222',
    userName: 'tester',
    globalName: 'Tester',
    locale: 'pt-BR'
};

function discordUser(opts) {
    return {
        id: opts.userId ?? defaults.userId,
        username: opts.userName ?? defaults.userName,
        global_name: opts.globalName ?? defaults.globalName,
        discriminator: '0001',
        avatar: 'default-avatar.png',
        public_flags: 0,
        bot: false
    };
}

function withGuild(opts, payload) {
    const guildId = opts.guildId ?? defaults.guildId;
    payload.guild_id = guildId;
    payload.guild = {
        id: guildId,
        locale: opts.locale ?? defaults.locale,
        features: []
    };
    payload.channel = { id: opts.channelId ?? defaults.channelId, type: 0 };
    payload.app_permissions = '0';
    payload.member = { roles: [], user: discordUser(opts) };
    return payload;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** Interação de APPLICATION_COMMAND (/comando). */
function buildCommandInteraction(opts) {
    const payload = {
        id: snowflake(),
        application_id: opts.applicationId ?? defaults.applicationId,
        type: InteractionType.APPLICATION_COMMAND,
        token: opts.token ?? snowflake(),
        version: 1,
        channel_id: opts.channelId ?? defaults.channelId,
        locale: opts.locale ?? defaults.locale,
        guild_locale: opts.locale ?? defaults.locale,
        data: {
            id: snowflake(),
            name: opts.name,
            type: 1,
            options: opts.options ?? []
        }
    };

    if (opts.inDM) {
        payload.user = discordUser(opts);
        return payload;
    }

    return withGuild(opts, payload);
}

/** Interação de MESSAGE_COMPONENT (botão etc.). */
function buildComponentInteraction(opts) {
    const payload = {
        id: snowflake(),
        application_id: opts.applicationId ?? defaults.applicationId,
        type: InteractionType.MESSAGE_COMPONENT,
        token: opts.token ?? snowflake(),
        version: 1,
        channel_id: opts.channelId ?? defaults.channelId,
        locale: opts.locale ?? defaults.locale,
        guild_locale: opts.locale ?? defaults.locale,
        data: {
            component_type: 2,
            custom_id: opts.componentId
        },
        message: { id: snowflake() }
    };

    if (opts.inDM) {
        payload.user = discordUser(opts);
        return payload;
    }

    return withGuild(opts, payload);
}

/** Interação de MODAL_SUBMIT. */
function buildModalInteraction(opts) {
    const payload = {
        id: snowflake(),
        application_id: opts.applicationId ?? defaults.applicationId,
        type: InteractionType.MODAL_SUBMIT,
        token: opts.token ?? snowflake(),
        version: 1,
        channel_id: opts.channelId ?? defaults.channelId,
        locale: opts.locale ?? defaults.locale,
        guild_locale: opts.locale ?? defaults.locale,
        data: {
            id: snowflake(),
            custom_id: opts.customId,
            type: 5,
            values: opts.values ?? []
        },
        message: { id: snowflake() }
    };

    if (opts.inDM) {
        payload.user = discordUser(opts);
        return payload;
    }

    return withGuild(opts, payload);
}

/** Interação de APPLICATION_COMMAND_AUTOCOMPLETE. */
function buildAutocompleteInteraction(opts) {
    const payload = {
        id: snowflake(),
        application_id: opts.applicationId ?? defaults.applicationId,
        type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE,
        token: opts.token ?? snowflake(),
        version: 1,
        channel_id: opts.channelId ?? defaults.channelId,
        locale: opts.locale ?? defaults.locale,
        guild_locale: opts.locale ?? defaults.locale,
        data: {
            id: snowflake(),
            name: opts.name,
            type: 1,
            options: [{ ...opts.focusedOption, focused: true }, ...(opts.options ?? [])]
        }
    };

    if (opts.inDM) {
        payload.user = discordUser(opts);
        return payload;
    }

    return withGuild(opts, payload);
}

/** Interação de PING (o bot responde PONG). Inclui usuário/guild por padrão,
 *  pois a rota chama loadUser() antes de checar o tipo. */
function buildPingInteraction(opts = {}) {
    const payload = {
        id: snowflake(),
        application_id: opts.applicationId ?? defaults.applicationId,
        type: InteractionType.PING,
        token: opts.token ?? snowflake(),
        version: 1,
        channel_id: opts.channelId ?? defaults.channelId,
        locale: opts.locale ?? defaults.locale,
        guild_locale: opts.locale ?? defaults.locale
    };

    if (opts.inDM) {
        payload.user = discordUser(opts);
        return payload;
    }

    return withGuild(opts, payload);
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/**
 * Envia a interação assinada para POST /interactions.
 * O corpo é serializado exatamente como assinado (sem reformatação).
 */
function postSignedInteraction(app, payload, overrides = {}) {
    const body = JSON.stringify(payload);
    const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000).toString();
    const signature = overrides.signature ?? sign(body, timestamp);

    return request(app)
        .post('/interactions')
        .set('x-signature-ed25519', signature)
        .set('x-signature-timestamp', timestamp)
        .set('Content-Type', 'application/json')
        .send(body);
}

/**
 * Envia um comando/componente e aguarda o `reply` (rest.patch no webhook).
 *
 * Motivo: a rota responde o acknowledge (HTTP 200) ANTES de executar o
 * comando; sem espera, asserções sobre o reply perdem a corrida sempre que
 * o comando faz I/O real (bcrypt) ou o worker está sob carga (coverage).
 * Todo fluxo de comando/componente termina em `int.reply()` (sucesso ou
 * erro), então aguardar +1 chamada de patch é determinístico.
 *
 * NÃO usar para PING, AUTOCOMPLETE ou 401 (respondem via res.json direta).
 */
async function postCommandAndWaitReply(app, payload, overrides = {}) {
    // O mock em test/mocks/rest.js vale para este import
    // dinâmico também, pois resolve para o mesmo módulo.
    const restMock = (await import('../../src/configs/rest')).default;
    const callsBefore = restMock.patch.mock.calls.length;
    const res = await postSignedInteraction(app, payload, overrides);
    await waitForCall(restMock.patch, callsBefore + 1);
    return res;
}

/**
 * Aguarda o app estar pronto: importa o `ready` exportado por src/app
 * (loadCache) em vez de um timeout arbitrário que causa race.
 */
async function waitAppReady() {
    const mod = await import('../../src/app');
    await mod.ready;
}

module.exports = {
    snowflake,
    sign,
    buildCommandInteraction,
    buildComponentInteraction,
    buildModalInteraction,
    buildAutocompleteInteraction,
    buildPingInteraction,
    postSignedInteraction,
    postCommandAndWaitReply,
    waitAppReady
};
