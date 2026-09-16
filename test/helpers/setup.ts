import nacl from 'tweetnacl';

// =============================================================================
// Setup global do Jest (configurado em jest.config.js -> setupFiles).
// Roda ANTES de qualquer import dos testes, porque o config.ts lê o env
// no momento do import.
// =============================================================================

process.env.NODE_ENV = 'test';

// Par de chaves ED25519 de teste:
//  - PUBLIC_KEY vai pro env (o middleware verifica as assinaturas contra ela);
//  - o secretKey fica guardado em globalThis para os testes assinarem os payloads.
const keyPair = nacl.sign.keyPair();
(globalThis as Record<string, unknown>).__TEST_KEY_PAIR__ = keyPair;
// Uint8Array.toString('hex') NÃO gera hex (join com vírgulas) — usar Buffer.
process.env.PUBLIC_KEY = Buffer.from(keyPair.publicKey).toString('hex');

// IDs do Discord validados no config.ts (18-20 digitos)
process.env.PORT = '0'; // porta efêmera — não conflita com o listen do startup
process.env.DATABASE_URL = 'postgresql://kami:test@localhost:5432/kami_test';
process.env.BOT_TOKEN = 'fake-bot-token';
process.env.CLIENT_ID = '111111111111111111';
process.env.CLIENT_SECRET = 'fake-client-secret';
process.env.OWNER_ID = '222222222222222222';
process.env.LOG_CHANNEL_ID = '333333333333333333';
process.env.COMMAND_WEBHOOK_ID = '444444444444444444';
process.env.COMMAND_WEBHOOK_TOKEN = 'command-webhook-token';
process.env.LOG_WEBHOOK_ID = '555555555555555555';
process.env.LOG_WEBHOOK_TOKEN = 'log-webhook-token';
process.env.BOT_STATUS_CHANNEL_ID = '666666666666666666';
process.env.BOT_STATUS_MESSAGE_ID = '777777777777777777';
process.env.EMBED_COLOR = '0x3498db';
process.env.API_TOKEN = 'api-token';
process.env.INSTANCE_TYPE = 'primary';
