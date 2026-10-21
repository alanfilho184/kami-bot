import config from '../configs/config';
import logger from '../configs/logger';
import ms from 'ms';
import botPresence from './bot-presence';
import botStatus from './bot-status';
import CloudflareDns from './cloudflare-dns';
import type { DnsApplyResult, DnsTarget } from './cloudflare-dns';
import { isAutomaticDnsEnabled } from './dns-policy';
import { ActivityType } from 'discord.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Exige 3 checks consecutivos com a primária online antes de devolver o DNS (~2-3 min com o loop de 1 min).
const PRIMARY_ONLINE_SUCCESSES_REQUIRED = 3;

class TakeOver {
    public takingOver: boolean = false;
    private canTakeOver: boolean = config.INSTANCE_TYPE === 'backup';
    private maxRetryCount: number = 3;
    private timeoutBeforeRetry: number = ms('10s');
    private retryCount: number = 0;
    private primaryOnlineSuccessCount: number = 0;
    private isChecking: boolean = false;
    private readonly automaticDnsEnabled: boolean = isAutomaticDnsEnabled(config.NODE_ENV);
    private dns: CloudflareDns | null = null;
    private pendingDnsTarget: DnsTarget | null = null;
    private pendingDnsRetryAt: number = 0;
    private dnsRetryDelay: number = ms('1m');

    constructor() {
        if (process.env.NODE_ENV === 'test') {
            return;
        }

        this.initializeDns();

        void this.initialize();
        setInterval(() => {
            void this.decideOnTakeOver();
        }, ms('1m'));
    }

    private initializeDns(): void {
        if (!this.canTakeOver) {
            return;
        }

        // A troca automática de DNS só roda em produção; o CLI (npm run dns:*) continua livre.
        if (!this.automaticDnsEnabled) {
            logger.logText(
                'INFO',
                'Automatic DNS failover is disabled outside production; use "npm run dns:*" to switch manually'
            );
            return;
        }

        this.dns = new CloudflareDns({
            apiToken: config.CLOUDFLARE_API_TOKEN ?? '',
            zoneId: config.CLOUDFLARE_ZONE_ID ?? '',
            recordName: config.CLOUDFLARE_DNS_RECORD_NAME ?? '',
            ttl: config.CLOUDFLARE_DNS_TTL,
            targets: {
                primary: {
                    type: config.CLOUDFLARE_DNS_PRIMARY_TYPE ?? 'CNAME',
                    content: config.CLOUDFLARE_DNS_PRIMARY_CONTENT ?? '',
                    proxied: config.CLOUDFLARE_DNS_PRIMARY_PROXIED ?? true
                },
                backup: {
                    type: config.CLOUDFLARE_DNS_BACKUP_TYPE ?? 'CNAME',
                    content: config.CLOUDFLARE_DNS_BACKUP_CONTENT ?? '',
                    proxied: config.CLOUDFLARE_DNS_BACKUP_PROXIED ?? true
                }
            }
        });

        if (!this.dns.isConfigured) {
            logger.logText('ERROR', 'Cloudflare DNS failover is not configured; DNS will not be switched');
        }
    }

    private async initialize(): Promise<void> {
        try {
            await this.reconcileDns();
            await this.decideOnTakeOver();
        } catch (err) {
            logger.logText('ERROR', `Failover initialization failed: ${this.errorMessage(err)}`);
        }
    }

    private async reconcileDns(): Promise<void> {
        if (!this.dns || !this.dns.isConfigured) {
            return;
        }

        try {
            const isPrimaryOnline = await this.checkPrimaryStatus();
            if (!isPrimaryOnline) {
                return;
            }

            const result = await this.dns.apply('primary');
            this.handleDnsResult('primary', result);

            if (result.ok) {
                this.clearPendingDns();
            } else {
                this.scheduleDnsRetry('primary');
            }
        } catch (err) {
            logger.logText('ERROR', `DNS reconciliation failed: ${this.errorMessage(err)}`);
            this.scheduleDnsRetry('primary');
        }
    }

    private async checkPrimaryStatus(): Promise<boolean> {
        try {
            const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };

            if (config.PRIMARY_INSTANCE_API_TOKEN) {
                headers.Authorization = config.PRIMARY_INSTANCE_API_TOKEN;
            }

            const res = await fetch(config.PRIMARY_INSTANCE_STATUS_URL as string, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(15000)
            });

            if (res.status !== 200) {
                return false;
            }

            let data: { instance_type?: string } | null;

            try {
                data = (await res.json()) as { instance_type?: string } | null;
            } catch {
                return false;
            }

            if (data?.instance_type && data.instance_type !== 'primary') {
                return false;
            }

            return true;
        } catch {
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
                if (this.takingOver) {
                    this.primaryOnlineSuccessCount++;

                    if (this.primaryOnlineSuccessCount >= PRIMARY_ONLINE_SUCCESSES_REQUIRED) {
                        await this.handOver();
                    } else {
                        logger.logText(
                            'INFO',
                            `Primary is online (${this.primaryOnlineSuccessCount}/${PRIMARY_ONLINE_SUCCESSES_REQUIRED}); waiting before DNS handback`
                        );
                    }
                } else {
                    this.primaryOnlineSuccessCount = 0;
                    await this.retryPendingDns('primary');
                }
            } else {
                this.primaryOnlineSuccessCount = 0;

                if (this.takingOver) {
                    await this.retryPendingDns('backup');
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
                            await this.takeOver();
                        }
                    }
                }
            }
        } catch (err) {
            logger.logText('ERROR', `Failover check failed: ${this.errorMessage(err)}`);
        } finally {
            this.isChecking = false;
        }
    }

    private async retryPendingDns(target: DnsTarget): Promise<void> {
        if (!this.dns || !this.dns.isConfigured) {
            return;
        }

        if (this.pendingDnsTarget !== target || Date.now() < this.pendingDnsRetryAt) {
            return;
        }

        try {
            const result = await this.dns.apply(target);
            this.handleDnsResult(target, result);

            if (result.ok) {
                this.clearPendingDns();
            } else {
                this.scheduleDnsRetry(target, true);
            }
        } catch (err) {
            logger.logText('ERROR', `DNS failover retry failed: ${this.errorMessage(err)}`);
            this.scheduleDnsRetry(target, true);
        }
    }

    private scheduleDnsRetry(target: DnsTarget, isRetry: boolean = false): void {
        this.pendingDnsTarget = target;
        this.dnsRetryDelay = isRetry ? Math.min(this.dnsRetryDelay * 2, ms('30m')) : ms('1m');
        this.pendingDnsRetryAt = Date.now() + this.dnsRetryDelay;
    }

    private clearPendingDns(): void {
        this.pendingDnsTarget = null;
        this.pendingDnsRetryAt = 0;
        this.dnsRetryDelay = ms('1m');
    }

    private handleDnsResult(target: DnsTarget, result: DnsApplyResult): void {
        const recordName = config.CLOUDFLARE_DNS_RECORD_NAME ?? 'DNS record';

        if (!result.ok) {
            logger.logText(
                'ERROR',
                `DNS failover: failed to switch ${recordName} to ${target}: ${result.error ?? 'unknown error'}`
            );
            return;
        }

        if (result.changed) {
            logger.logText(
                'WARN',
                `DNS switch: ${recordName} -> ${result.desired.content} (${target}, ${result.action})`,
                true
            );
        }
    }

    private async checkInternetConnection(): Promise<boolean> {
        try {
            const res = await fetch('https://cloudflare.com/cdn-cgi/trace', {
                method: 'GET',
                signal: AbortSignal.timeout(15000)
            });

            return res.ok;
        } catch {
            return false;
        }
    }

    private async takeOver(): Promise<void> {
        if (!this.canTakeOver) {
            return;
        }

        logger.logText('ERROR', 'Primary is offline, backup is taking over');
        this.takingOver = true;
        this.primaryOnlineSuccessCount = 0;
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

        if (!this.dns || !this.dns.isConfigured) {
            return;
        }

        try {
            const result = await this.dns.apply('backup');
            this.handleDnsResult('backup', result);

            if (result.ok) {
                this.clearPendingDns();
            } else {
                this.scheduleDnsRetry('backup');
            }
        } catch (err) {
            logger.logText('ERROR', `DNS failover failed: ${this.errorMessage(err)}`);
            this.scheduleDnsRetry('backup');
        }
    }

    private async handOver(): Promise<void> {
        logger.logText('ERROR', 'Primary is back online, backup is handing over');
        this.takingOver = false;
        this.primaryOnlineSuccessCount = 0;
        void botPresence.disable();
        botStatus.disable();

        if (!this.dns || !this.dns.isConfigured) {
            return;
        }

        try {
            const result = await this.dns.apply('primary');
            this.handleDnsResult('primary', result);

            if (result.ok) {
                this.clearPendingDns();
            } else {
                this.scheduleDnsRetry('primary');
            }
        } catch (err) {
            logger.logText('ERROR', `DNS failover failed: ${this.errorMessage(err)}`);
            this.scheduleDnsRetry('primary');
        }
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

const takeOver = new TakeOver();

export default takeOver;
