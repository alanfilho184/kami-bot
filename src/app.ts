import express from 'express';
import middlewares from './middlewares';
import routes from './routes';
import config from './configs/config';
import { sendStartupWebhook } from './logs/discord-logger';
import sheetNameCache from './resources/cache/sheet-name.cache';
import botStatus from './modules/bot-status';
import './modules/bot-presence';
import './modules/take-over';

const app = express();

app.use(express.raw({ type: '*/*' }));
app.use(middlewares);
app.use(routes);

const ready: Promise<void> = sheetNameCache.loadCache().catch(err => {
    if (process.env.NODE_ENV !== 'test') {
        console.error('Failed to load sheet name cache', err);
    }
});

async function startup() {
    await ready;

    if (process.env.NODE_ENV === 'test') {
        return;
    }

    app.listen(config.PORT, () => {
        console.log(`Server is running on port ${config.PORT}`);
        sendStartupWebhook().catch(err => console.error('Failed to send startup webhook', err));
        botStatus?.updateStatusMessage();
    });
}

startup();

export default app;
export { ready };
