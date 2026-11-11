import config from '../configs/config';
import logger from '../configs/logger';
import ms from 'ms';
import botPresence from './bot-presence';
import botStatus from './bot-status';
import CloudflareDns from './cloudflare-dns';
import type { DnsApplyResult, DnsRecordConfig, DnsTarget } from './cloudflare-dns';
import { isAutomaticDnsEnabled } from './dns-policy';
import { higherPriorityRoles, pickHandbackTarget, type InstanceRole } from '../types/instance';
import { ActivityType } from 'discord.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Exige 3 ciclos consecutivos com um peer de maior prioridade online antes
// de devolver o DNS (~3 min com o loop de 1 min).
const HANDOVER_SUCCESSES_REQUIRED = 3;

// Mesmo comportamento do modelo anterior: 3 novas checagens, 10s entre elas,
// antes de assumir.
const TAKEOVER_CHECKS_REQUIRED = 3;
const TAKEOVER_RETRY_DELAY = ms('10s');
const STATUS_TIMEOUT = ms('15s');

type FailoverPeer = {
    role: InstanceRole;
    statusUrl?: string;
    apiToken?: string;
};

class TakeOver {
    public takingOver: boolean = false;
    private readonly role: InstanceRole;
    private readonly peers: FailoverPeer[];
    private failoverEnabled: boolean;
    private handoverSuccessCount: number = 0;
    private handoverTarget: InstanceRole | null = null;
    private isChecking: boolean = false;
    private readonly automaticDnsEnabled: boolean = isAutomaticDnsEnabled(config.NODE_ENV);
    private dns: CloudflareDns | null = null;
    private pendingDnsTarget: DnsTarget | null = null;
    private pendingDnsRetryAt: number = 0;
    private dnsRetryDelay: number = ms('1m');
    private interval: NodeJS.Timeout | null = null;

    constructor() {
        this.role = config.INSTANCE_TYPE;
        this.peers = this.buildPeers();
        this.failoverEnabled =
            this.role !== 'primary' &&
            this.peers.every(peer => Boolean(peer.statusUrl && peer.apiToken)) &&
            this.automaticDnsEnabled;

        if (process.env.NODE_ENV === 'test') {
            return;
        }

        this.logConfiguration();
        this.initializeDns();

        void this.initialize();
        this.interval = setInterval(() => {
            void this.decideOnTakeOver();
        }, ms('1m'));
    }

    public stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    private get dnsTarget(): DnsTarget {
        return this.role;
    }

    private buildPeers(): FailoverPeer[] {
        return higherPriorityRoles(this.role).map(role => ({
            role,
            statusUrl: role === 'primary' ? config.PRIMARY_INSTANCE_STATUS_URL : config.SECONDARY_INSTANCE_STATUS_URL,
            apiToken: role === 'primary' ? config.PRIMARY_INSTANCE_API_TOKEN : config.SECONDARY_INSTANCE_API_TOKEN
        }));
    }

    private logConfiguration(): void {
        if (this.role === 'primary') {
            logger.info('Failover role: primary (take-over disabled)', {
                event: 'failover.config',
                instance_role: this.role
            });
            return;
        }

        if (!this.automaticDnsEnabled) {
            logger.info('Automatic DNS failover is disabled outside production; take-over is disarmed', {
                event: 'failover.dns.disabled',
                instance_role: this.role
            });
            return;
        }

        const monitored = this.peers.map(peer => peer.role).join(', ') || 'none';
        logger.info(`Failover role: ${this.role}; monitoring: ${monitored}`, {
            event: 'failover.config',
            instance_role: this.role
        });

        const missing = this.peers.filter(peer => !peer.statusUrl || !peer.apiToken);

        if (missing.length > 0) {
            logger.error(
                `Automatic failover is disabled: missing status URL/token for ${missing
                    .map(peer => peer.role)
                    .join(', ')}`,
                {
                    event: 'failover.config.missing',
                    instance_role: this.role,
                    notifyDiscord: true
                }
            );
        }
    }

    private initializeDns(): void {
        if (!this.failoverEnabled) {
            return;
        }

        // A troca automática de DNS só roda em produção; o CLI (npm run dns:*) continua livre.
        if (!this.automaticDnsEnabled) {
            logger.info(
                'Automatic DNS failover is disabled outside production; use "npm run dns:*" to switch manually',
                {
                    event: 'failover.dns.disabled',
                    instance_role: this.role
                }
            );
            return;
        }

        const targets: Partial<Record<DnsTarget, DnsRecordConfig>> = {
            primary: {
                type: config.CLOUDFLARE_DNS_PRIMARY_TYPE ?? 'CNAME',
                content: config.CLOUDFLARE_DNS_PRIMARY_CONTENT ?? '',
                proxied: config.CLOUDFLARE_DNS_PRIMARY_PROXIED ?? true
            },
            secondary: {
                type: config.CLOUDFLARE_DNS_SECONDARY_TYPE ?? 'CNAME',
                content: config.CLOUDFLARE_DNS_SECONDARY_CONTENT ?? '',
                proxied: config.CLOUDFLARE_DNS_SECONDARY_PROXIED ?? true
            }
        };

        if (config.CLOUDFLARE_DNS_BACKUP_CONTENT) {
            targets.backup = {
                type: config.CLOUDFLARE_DNS_BACKUP_TYPE ?? 'CNAME',
                content: config.CLOUDFLARE_DNS_BACKUP_CONTENT,
                proxied: config.CLOUDFLARE_DNS_BACKUP_PROXIED ?? true
            };
        }

        this.dns = new CloudflareDns({
            apiToken: config.CLOUDFLARE_API_TOKEN ?? '',
            zoneId: config.CLOUDFLARE_ZONE_ID ?? '',
            recordName: config.CLOUDFLARE_DNS_RECORD_NAME ?? '',
            ttl: config.CLOUDFLARE_DNS_TTL,
            targets
        });

        if (!this.dns.isConfigured) {
            logger.error('Cloudflare DNS failover is not configured; automatic failover is disabled', {
                event: 'failover.dns.config',
                instance_role: this.role,
                notifyDiscord: true
            });
            this.dns = null;
            this.failoverEnabled = false;
            return;
        }

        if (!this.dns.hasTarget(this.dnsTarget)) {
            logger.error(`DNS target for "${this.dnsTarget}" is not configured; automatic failover is disabled`, {
                event: 'failover.dns.config',
                instance_role: this.role,
                failover_target: this.dnsTarget,
                notifyDiscord: true
            });
            this.dns = null;
            this.failoverEnabled = false;
        }
    }

    private async initialize(): Promise<void> {
        if (!this.failoverEnabled) {
            return;
        }

        try {
            // Se o processo reiniciou no meio de um failover e o DNS já aponta
            // para este host, reassume imediatamente em vez de esperar ~30s.
            if (this.dns) {
                const onlinePeers = await this.getOnlinePeers();
                const current = await this.dns.getCurrentTarget();

                if (onlinePeers.length === 0 && current === this.dnsTarget) {
                    await this.takeOver();
                    return;
                }
            }

            await this.decideOnTakeOver();
        } catch (err) {
            logger.error(err, {
                event: 'failover.initialization.error',
                instance_role: this.role,
                notifyDiscord: true
            });
        }
    }

    private async decideOnTakeOver(): Promise<void> {
        if (!this.failoverEnabled || this.isChecking) {
            return;
        }

        this.isChecking = true;

        try {
            const onlinePeers = await this.getOnlinePeers();
            const targetPeer = this.highestOnlinePeer(onlinePeers);

            if (targetPeer) {
                if (this.handoverTarget !== targetPeer.role) {
                    this.handoverTarget = targetPeer.role;
                    this.handoverSuccessCount = 0;
                }

                if (this.takingOver) {
                    this.handoverSuccessCount++;

                    if (this.handoverSuccessCount >= HANDOVER_SUCCESSES_REQUIRED) {
                        await this.handOver(targetPeer);
                    } else {
                        logger.info(
                            `Higher-priority instance ${targetPeer.role} is online (${this.handoverSuccessCount}/${HANDOVER_SUCCESSES_REQUIRED}); waiting before DNS handback`,
                            {
                                event: 'failover.handback.waiting',
                                instance_role: this.role,
                                failover_target: targetPeer.role
                            }
                        );
                    }
                } else {
                    this.handoverSuccessCount = 0;
                    await this.reconcilePassiveDns(onlinePeers);
                }

                return;
            }

            this.handoverTarget = null;
            this.handoverSuccessCount = 0;

            if (this.takingOver) {
                await this.ensureDns(this.dnsTarget);
                return;
            }

            const isInternetConnected = await this.checkInternetConnection();

            if (!isInternetConnected) {
                return;
            }

            for (let attempt = 0; attempt < TAKEOVER_CHECKS_REQUIRED; attempt++) {
                await sleep(TAKEOVER_RETRY_DELAY);

                const retryOnlinePeers = await this.getOnlinePeers();

                if (retryOnlinePeers.length > 0) {
                    return;
                }
            }

            await this.takeOver();
        } catch (err) {
            logger.error(err, {
                event: 'failover.check.error',
                instance_role: this.role,
                notifyDiscord: true
            });
        } finally {
            this.isChecking = false;
        }
    }

    private async getOnlinePeers(): Promise<FailoverPeer[]> {
        const statuses = await Promise.all(
            this.peers.map(async peer => ({
                peer,
                online: await this.checkPeer(peer)
            }))
        );

        return statuses.filter(status => status.online).map(status => status.peer);
    }

    private highestOnlinePeer(onlinePeers: FailoverPeer[]): FailoverPeer | null {
        const target = pickHandbackTarget(
            this.role,
            onlinePeers.map(peer => peer.role)
        );

        return target ? (onlinePeers.find(peer => peer.role === target) ?? null) : null;
    }

    private async checkPeer(peer: FailoverPeer): Promise<boolean> {
        if (!peer.statusUrl || !peer.apiToken) {
            return false;
        }

        try {
            const res = await fetch(peer.statusUrl, {
                method: 'GET',
                headers: {
                    Authorization: peer.apiToken,
                    'Cache-Control': 'no-cache'
                },
                signal: AbortSignal.timeout(STATUS_TIMEOUT)
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

            if (data?.instance_type && data.instance_type !== peer.role) {
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    /**
     * Um host passivo só corrige o DNS quando o alvo atual não é um peer
     * superior saudável. Se o alvo atual é um peer superior online (mesmo que
     * não seja o de maior prioridade), quem está ativo cuida do handback.
     */
    private async reconcilePassiveDns(onlinePeers: FailoverPeer[]): Promise<void> {
        if (!this.dns || !this.dns.isConfigured || onlinePeers.length === 0) {
            return;
        }

        const targetPeer = onlinePeers[0];

        try {
            const current = await this.dns.getCurrentTarget();

            if (current === targetPeer.role) {
                return;
            }

            if (current && onlinePeers.some(peer => peer.role === current)) {
                return;
            }

            await this.ensureDns(targetPeer.role);
        } catch (err) {
            logger.error(err, {
                event: 'failover.dns.reconcile_error',
                instance_role: this.role,
                notifyDiscord: true
            });
        }
    }

    private async ensureDns(target: DnsTarget): Promise<boolean> {
        if (!this.dns || !this.dns.isConfigured) {
            return false;
        }

        const isRetry = this.pendingDnsTarget === target && this.pendingDnsRetryAt > 0;

        if (this.pendingDnsTarget !== target) {
            this.pendingDnsTarget = target;
            this.pendingDnsRetryAt = 0;
            this.dnsRetryDelay = ms('1m');
        }

        // O backoff evita martelar a API da Cloudflare quando ela está
        // indisponível/limitando. Nesse caso o estado ativo não é confirmado.
        if (Date.now() < this.pendingDnsRetryAt) {
            return false;
        }

        try {
            const result = await this.dns.apply(target);
            this.handleDnsResult(target, result);

            if (result.ok) {
                this.clearPendingDns();
                return true;
            }

            this.scheduleDnsRetry(target, isRetry);
            return false;
        } catch (err) {
            logger.error(err, {
                event: 'failover.dns.error',
                instance_role: this.role,
                failover_target: target,
                notifyDiscord: true
            });
            this.scheduleDnsRetry(target, isRetry);
            return false;
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
            logger.error(
                `DNS failover: failed to switch ${recordName} to ${target}: ${result.error ?? 'unknown error'}`,
                {
                    event: 'failover.dns.error',
                    instance_role: this.role,
                    failover_target: target,
                    notifyDiscord: true
                }
            );
            return;
        }

        if (result.changed) {
            logger.logText(
                'WARN',
                `DNS switch: ${recordName} -> ${result.desired.content} (${target}, ${result.action})`,
                true,
                {
                    event: 'failover.dns.switch',
                    instance_role: this.role,
                    failover_target: target,
                    dns_changed: result.changed,
                    action: result.action
                }
            );
        }
    }

    private async checkInternetConnection(): Promise<boolean> {
        try {
            const res = await fetch('https://cloudflare.com/cdn-cgi/trace', {
                method: 'GET',
                signal: AbortSignal.timeout(STATUS_TIMEOUT)
            });

            return res.ok;
        } catch {
            return false;
        }
    }

    private takeOverMessage(): string {
        if (this.role === 'secondary') {
            return 'Primary is offline, secondary is taking over';
        }

        return 'Primary and secondary are offline, backup is taking over';
    }

    private handOverMessage(targetPeer: FailoverPeer): string {
        if (targetPeer.role === 'primary') {
            return `Primary is back online, ${this.role} is handing over`;
        }

        return `Secondary is back online, ${this.role} is handing over`;
    }

    private async takeOver(): Promise<void> {
        if (!this.failoverEnabled) {
            return;
        }

        logger.error(this.takeOverMessage(), {
            event: 'failover.takeover',
            instance_role: this.role,
            failover_target: this.dnsTarget,
            notifyDiscord: true
        });

        // Só assumimos depois que o DNS realmente aponta para esta instância.
        // Se a Cloudflare estiver fora, a tentativa fica pendente e o
        // `takingOver` continua falso — evitando double-write de IRT.
        const dnsOk = await this.ensureDns(this.dnsTarget);

        if (!dnsOk) {
            logger.warn('Takeover postponed: DNS switch is still pending', {
                event: 'failover.takeover.pending',
                instance_role: this.role,
                failover_target: this.dnsTarget,
                notifyDiscord: true
            });
            return;
        }

        this.takingOver = true;
        this.handoverSuccessCount = 0;
        this.handoverTarget = null;
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

    private async handOver(targetPeer: FailoverPeer): Promise<void> {
        logger.error(this.handOverMessage(targetPeer), {
            event: 'failover.handback',
            instance_role: this.role,
            failover_target: targetPeer.role,
            notifyDiscord: true
        });

        // Mantém o estado ativo (e o sync de IRT) até o DNS apontar de volta
        // para o peer. Se a troca falhar, o próximo ciclo tenta novamente.
        const dnsOk = await this.ensureDns(targetPeer.role);

        if (!dnsOk) {
            logger.warn('Handback postponed: DNS switch is still pending', {
                event: 'failover.handback.pending',
                instance_role: this.role,
                failover_target: targetPeer.role,
                notifyDiscord: true
            });
            return;
        }

        this.takingOver = false;
        this.handoverSuccessCount = 0;
        this.handoverTarget = null;
        void botPresence.disable();
        botStatus.disable();
    }
}

const takeOver = new TakeOver();

export default takeOver;
