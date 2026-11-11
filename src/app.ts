import express from 'express';
import middlewares from './middlewares';
import routes from './routes';
import config from './configs/config';
import db from './configs/database';
import logger from './configs/logger';
import { sendStartupWebhook } from './logs/discord-logger';
import sheetNameCache from './resources/cache/sheet-name.cache';
import botStatus from './modules/bot-status';
import './modules/bot-presence';
import takeOver from './modules/take-over';
import { startSheetSync, stopSheetSync } from './modules/sheet-sync';

const app = express();

app.use(express.raw({ type: '*/*' }));
app.use(middlewares);
app.use(routes);

const ready: Promise<void> = sheetNameCache.loadCache().catch(err => {
    if (process.env.NODE_ENV !== 'test') {
        console.error('Failed to load sheet name cache', err);
    }
});

let server: ReturnType<typeof app.listen> | null = null;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    logger.info('Shutting down', { event: 'app.shutdown', action: signal });

    const forceExit = setTimeout(() => process.exit(1), 5000);
    forceExit.unref();

    try {
        stopSheetSync();
        takeOver.stop();
    } catch {
        // o encerramento não pode falhar por causa do sync/failover
    }

    if (server) {
        await new Promise<void>(resolve => {
            server!.close(() => resolve());
        });
    }

    await logger.close().catch(() => undefined);
    await db.$disconnect().catch(() => undefined);

    clearTimeout(forceExit);
    process.exit(0);
}

if (process.env.NODE_ENV !== 'test') {
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM');
    });

    process.once('SIGINT', () => {
        void shutdown('SIGINT');
    });
}

async function startup() {
    await ready;

    if (process.env.NODE_ENV === 'test' || shuttingDown) {
        return;
    }

    server = app.listen(config.PORT, () => {
        if (shuttingDown) {
            return;
        }

        console.log(`Server is running on port ${config.PORT}`);
        logger.info('Server started', { event: 'app.start', action: config.INSTANCE_TYPE });

        // Só inicia o socket/reconcile depois que o HTTP está de pé. Se a URL
        // do site estiver inválida, o servidor continua respondendo e o erro
        // fica restrito à feature de sincronização.
        try {
            startSheetSync();
        } catch (err) {
            logger.error(err, { event: 'sheet.sync.start_failed' });
        }

        sendStartupWebhook().catch(err => console.error('Failed to send startup webhook', err));
        botStatus?.updateStatusMessage();
    });

    server.on('error', err => {
        logger.error(err, { event: 'app.listen.error', action: String(config.PORT) });

        if (process.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
    });
}

startup().catch(err => {
    logger.error(err, { event: 'app.startup.error' });
    console.error('Failed to start the application', err);

    if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
    }
});

export default app;
export { ready };
