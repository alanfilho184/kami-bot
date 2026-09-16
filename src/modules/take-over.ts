import config from '../configs/config';
import logger from '../configs/logger';
import ms from 'ms';
import botPresence from './bot-presence';
import botStatus from './bot-status';
import { ActivityType } from 'discord.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class TakeOver {
    public takingOver: boolean = false;
    private canTakeOver: boolean = config.INSTANCE_TYPE === 'backup';
    private maxRetryCount: number = 3;
    private timeoutBeforeRetry: number = ms('10s');
    private retryCount: number = 0;
    private isChecking: boolean = false;

    constructor() {
        if (process.env.NODE_ENV === 'test') return;
        this.decideOnTakeOver();
        setInterval(() => {
            this.decideOnTakeOver();
        }, ms('1m'));
    }

    private async checkPrimaryStatus(): Promise<boolean> {
        try {
            const res = await fetch(config.PRIMARY_INSTANCE_STATUS_URL!, {
                method: 'GET',
                headers: {
                    Authorization: config.PRIMARY_INSTANCE_API_TOKEN!
                }
            });

            if (res.status == 200) {
                return true;
            } else {
                return false;
            }
        } catch (err) {
            return false;
        }
    }

    private async decideOnTakeOver(): Promise<void> {
        if (config.INSTANCE_TYPE === 'primary') {
            return;
        }

        if (this.isChecking) {
            return;
        }
        this.isChecking = true;

        try {
            this.retryCount = 0;
            let isPrimaryOnline = await this.checkPrimaryStatus();

            if (isPrimaryOnline) {
                if (this.takingOver == true) {
                    this.handOver();
                }
            } else {
                if (this.takingOver) {
                    return;
                }

                const isInternetConnected = await this.checkInternetConnection();

                if (isInternetConnected) {
                    while (this.retryCount < this.maxRetryCount) {
                        await sleep(this.timeoutBeforeRetry);

                        isPrimaryOnline = await this.checkPrimaryStatus();

                        if (isPrimaryOnline) {
                            break;
                        } else {
                            this.retryCount++;
                            continue;
                        }
                    }

                    if (isPrimaryOnline === false) {
                        if (this.takingOver === false) {
                            this.takeOver();
                        }
                    }
                }
            }
        } finally {
            this.isChecking = false;
        }
    }

    private async checkInternetConnection(): Promise<boolean> {
        try {
            const res = await fetch('https://cloudflare.com/cdn-cgi/trace', {
                method: 'GET',
                signal: AbortSignal.timeout(15000)
            });

            if (res.ok) {
                return true;
            } else {
                return false;
            }
        } catch (err) {
            return false;
        }
    }

    private takeOver() {
        if (this.canTakeOver) {
            logger.logText('ERROR', 'Primary is offline, backup is taking over');
            this.takingOver = true;
            void botPresence.enable({
                status: 'dnd',
                activities: [
                    {
                        name: `Instabilidade Detectada`,
                        type: ActivityType.Playing
                    }
                ]
            });
            botStatus.enable();
        }
    }

    private handOver() {
        logger.logText('ERROR', 'Primary is back online, backup is handing over');
        this.takingOver = false;
        void botPresence.disable();
        botStatus.disable();
    }
}

const takeOver = new TakeOver();

export default takeOver;
