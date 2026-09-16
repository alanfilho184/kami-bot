import config from '../configs/config';
import { ActivityType, Client, ClientPresence, PresenceData, Routes } from 'discord.js';
import rest from '../configs/rest';

const defaultPresence: PresenceData = {
    status: 'online',
    activities: [
        {
            name: `v${config.VERSION}`,
            type: ActivityType.Playing
        }
    ]
};

class BotPresence {
    private client: Client | null = null;
    private enabling: Promise<void> | null = null;

    get isActive(): boolean {
        return this.client !== null;
    }

    private readyUser() {
        if (!this.client?.user) {
            throw new Error('Cliente ainda não está pronto: aguarde o login antes de setar a presença.');
        }
        return this.client.user;
    }

    async enable(presence: PresenceData = defaultPresence): Promise<void> {
        if (this.client) {
            return;
        }

        if (this.enabling) {
            return this.enabling;
        }

        this.enabling = (async () => {
            const gateway = (await rest.get(Routes.gatewayBot())) as { shards: number };
            const client = new Client({
                intents: [],
                shardCount: Number(gateway.shards)
            });

            await client.login(config.BOT_TOKEN);
            client.user?.setPresence(presence);
            this.client = client;
        })();

        try {
            await this.enabling;
        } finally {
            this.enabling = null;
        }
    }

    async disable(): Promise<void> {
        if (this.enabling) {
            await this.enabling.catch(() => {});
        }

        if (!this.client) {
            return;
        }

        await this.client.destroy();
        this.client = null;
    }

    set(presence: PresenceData): ClientPresence {
        return this.readyUser().setPresence(presence);
    }
}

const botPresence = new BotPresence();

if (process.env.NODE_ENV !== 'test' && config.INSTANCE_TYPE === 'primary') {
    void botPresence.enable();
}

export default botPresence;
