import { FAILOVER_ORDER, type InstanceRole } from '../types/instance';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT = 15_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [2_000, 5_000];

export type DnsTarget = InstanceRole;
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME';

export type DnsRecordConfig = {
    type: DnsRecordType;
    content: string;
    proxied: boolean;
};

export type CloudflareDnsOptions = {
    apiToken: string;
    zoneId: string;
    recordName: string;
    ttl?: number;
    targets: Partial<Record<DnsTarget, DnsRecordConfig>>;
};

export type DnsRecord = {
    id: string;
    type: DnsRecordType;
    name: string;
    content: string;
    proxied: boolean;
    ttl: number;
};

export type DnsApplyAction = 'noop' | 'patch' | 'create' | 'recreate';

export type DnsApplyResult = {
    ok: boolean;
    changed: boolean;
    action: DnsApplyAction;
    current: DnsRecord[];
    desired: DnsRecordConfig;
    error?: string;
};

export type DnsApplyOptions = {
    dryRun?: boolean;
};

type CloudflareEnvelope<T> = {
    success: boolean;
    result: T;
    errors?: { code: number; message: string }[];
};

const CONFLICTING_TYPES = new Set<DnsRecordType>(['A', 'AAAA', 'CNAME']);
const VALID_TYPES = new Set<string>(['A', 'AAAA', 'CNAME']);

const sleep = (time: number) => new Promise<void>(resolve => setTimeout(resolve, time));

class CloudflareDnsError extends Error {
    constructor(
        message: string,
        public readonly status?: number,
        public readonly transient: boolean = false
    ) {
        super(message);
        this.name = 'CloudflareDnsError';
    }
}

function normalizeContent(type: DnsRecordType, content: string): string {
    const value = content.trim();
    return type === 'CNAME' ? value.replace(/\.$/, '').toLowerCase() : value;
}

function normalizeName(name: string): string {
    return name.trim().replace(/\.$/, '').toLowerCase();
}

export class CloudflareDns {
    private readonly options: CloudflareDnsOptions;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(options: CloudflareDnsOptions) {
        this.options = options;
    }

    get isConfigured(): boolean {
        const targets = this.options.targets;

        return Boolean(
            this.options.apiToken &&
            this.options.zoneId &&
            this.options.recordName &&
            this.isValidTarget(targets?.primary) &&
            this.isValidTarget(targets?.secondary) &&
            (!targets?.backup || this.isValidTarget(targets.backup))
        );
    }

    public hasTarget(target: DnsTarget): boolean {
        return this.isValidTarget(this.options.targets?.[target]);
    }

    public apply(target: DnsTarget, options: DnsApplyOptions = {}): Promise<DnsApplyResult> {
        return this.enqueue(() => this.doApply(target, options));
    }

    public getRecords(): Promise<DnsRecord[]> {
        return this.enqueue(() => this.fetchRecords());
    }

    public getCurrentTarget(): Promise<DnsTarget | null> {
        return this.enqueue(() => this.doGetCurrentTarget());
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.queue.then(operation, operation);
        this.queue = next.then(
            () => undefined,
            () => undefined
        );
        return next;
    }

    private isValidTarget(target?: DnsRecordConfig): boolean {
        if (!target) {
            return false;
        }

        if (!VALID_TYPES.has(target.type)) {
            return false;
        }

        if (!target.content || target.content.trim() === '') {
            return false;
        }

        if (typeof target.proxied !== 'boolean') {
            return false;
        }

        if (target.type === 'CNAME' && normalizeName(target.content) === normalizeName(this.options.recordName ?? '')) {
            return false;
        }

        return true;
    }

    private resolveTtl(proxied: boolean): number {
        return proxied ? 1 : (this.options.ttl ?? 60);
    }

    private matches(record: DnsRecord, desired: DnsRecordConfig): boolean {
        return (
            record.type === desired.type &&
            normalizeContent(record.type, record.content) === normalizeContent(desired.type, desired.content) &&
            Boolean(record.proxied) === desired.proxied &&
            record.ttl === this.resolveTtl(desired.proxied)
        );
    }

    private async doApply(target: DnsTarget, options: DnsApplyOptions): Promise<DnsApplyResult> {
        const desired = this.options.targets?.[target];

        if (!desired) {
            return {
                ok: false,
                changed: false,
                action: 'noop',
                current: [],
                desired: { type: 'CNAME', content: '', proxied: true },
                error: `Unknown DNS target: ${target}`
            };
        }

        const base: DnsApplyResult = {
            ok: false,
            changed: false,
            action: 'noop',
            current: [],
            desired
        };

        if (!this.isConfigured) {
            return { ...base, error: 'Cloudflare DNS is not configured' };
        }

        let current: DnsRecord[];

        try {
            current = await this.fetchRecords();
        } catch (err) {
            return { ...base, error: this.errorMessage(err) };
        }

        const conflicting = current.filter(record => CONFLICTING_TYPES.has(record.type));
        const sameType = conflicting.filter(record => record.type === desired.type);
        const otherTypes = conflicting.filter(record => record.type !== desired.type);

        if (conflicting.length === 1 && sameType.length === 1 && this.matches(sameType[0], desired)) {
            return { ...base, ok: true, current };
        }

        let action: DnsApplyAction;
        let keeper: DnsRecord | undefined;
        let extras: DnsRecord[] = [];

        if (sameType.length > 0 && otherTypes.length === 0) {
            action = 'patch';
            keeper = sameType.find(record => this.matches(record, desired)) ?? sameType[0];
            extras = sameType.filter(record => record.id !== keeper!.id);
        } else if (conflicting.length === 0) {
            action = 'create';
        } else {
            action = 'recreate';
        }

        const result: DnsApplyResult = {
            ...base,
            changed: true,
            action,
            current
        };

        if (options.dryRun) {
            return { ...result, ok: true };
        }

        try {
            if (action === 'patch') {
                const recordToPatch = keeper!;

                if (!this.matches(recordToPatch, desired)) {
                    await this.patchRecord(recordToPatch.id, desired);
                }

                for (const extra of extras) {
                    await this.deleteRecord(extra.id);
                }

                return { ...result, ok: true, changed: true };
            }

            if (action === 'create') {
                try {
                    await this.createRecord(desired);
                } catch (err) {
                    const created = await this.findDesiredAfterFailure(desired);
                    if (created) {
                        return { ...result, ok: true, changed: true };
                    }
                    throw err;
                }

                return { ...result, ok: true, changed: true };
            }

            const previous = conflicting;
            const deleted: DnsRecord[] = [];

            try {
                for (const record of previous) {
                    await this.deleteRecord(record.id);
                    deleted.push(record);
                }
            } catch (err) {
                const rollbackOk = deleted.length > 0 ? await this.rollback(deleted) : true;
                return {
                    ...result,
                    ok: false,
                    error: `${this.errorMessage(err)}${this.rollbackMessage(rollbackOk)}`
                };
            }

            try {
                await this.createRecord(desired);
            } catch (err) {
                const created = await this.findDesiredAfterFailure(desired);
                if (created) {
                    return { ...result, ok: true, changed: true };
                }

                const rollbackOk = await this.rollback(previous);
                return {
                    ...result,
                    ok: false,
                    error: `${this.errorMessage(err)}${this.rollbackMessage(rollbackOk)}`
                };
            }

            return { ...result, ok: true, changed: true };
        } catch (err) {
            return { ...result, ok: false, error: this.errorMessage(err) };
        }
    }

    private async doGetCurrentTarget(): Promise<DnsTarget | null> {
        if (!this.isConfigured) {
            return null;
        }

        const records = await this.fetchRecords();

        for (const target of FAILOVER_ORDER) {
            const desired = this.options.targets?.[target];

            if (desired && records.some(record => this.matches(record, desired))) {
                return target;
            }
        }

        return null;
    }

    private async findDesiredAfterFailure(desired: DnsRecordConfig): Promise<boolean> {
        const records = await this.fetchRecords().catch(() => []);
        return records.some(record => this.matches(record, desired));
    }

    private async rollback(records: DnsRecord[]): Promise<boolean> {
        try {
            for (const record of records) {
                await this.createRecord({
                    name: record.name,
                    type: record.type,
                    content: record.content,
                    proxied: Boolean(record.proxied),
                    ttl: record.ttl
                });
            }
            return true;
        } catch {
            return false;
        }
    }

    private rollbackMessage(rollbackOk: boolean): string {
        return rollbackOk ? ' (rollback restored the previous record)' : ' (rollback failed)';
    }

    private async fetchRecords(): Promise<DnsRecord[]> {
        const records = await this.request<DnsRecord[]>(
            `${API_BASE}/zones/${encodeURIComponent(this.options.zoneId)}/dns_records?name=${encodeURIComponent(
                this.options.recordName
            )}&per_page=100`,
            { method: 'GET' }
        );

        const recordName = normalizeName(this.options.recordName);
        return (records ?? []).filter(record => normalizeName(record.name) === recordName);
    }

    private async createRecord(record: DnsRecordConfig & { name?: string; ttl?: number }): Promise<void> {
        await this.request(`${API_BASE}/zones/${encodeURIComponent(this.options.zoneId)}/dns_records`, {
            method: 'POST',
            body: JSON.stringify({
                type: record.type,
                name: record.name ?? this.options.recordName,
                content: record.content,
                proxied: record.proxied,
                ttl: record.ttl ?? this.resolveTtl(record.proxied)
            })
        });
    }

    private async patchRecord(id: string, desired: DnsRecordConfig): Promise<void> {
        await this.request(`${API_BASE}/zones/${encodeURIComponent(this.options.zoneId)}/dns_records/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
                content: desired.content,
                proxied: desired.proxied,
                ttl: this.resolveTtl(desired.proxied)
            })
        });
    }

    private async deleteRecord(id: string): Promise<void> {
        try {
            await this.request(`${API_BASE}/zones/${encodeURIComponent(this.options.zoneId)}/dns_records/${id}`, {
                method: 'DELETE'
            });
        } catch (err) {
            if (err instanceof CloudflareDnsError && err.status === 404) {
                return;
            }
            throw err;
        }
    }

    private async request<T>(url: string, init: RequestInit, attempt = 1): Promise<T> {
        const method = (init.method ?? 'GET').toUpperCase();
        const retryable = method !== 'POST';

        try {
            const response = await fetch(url, {
                ...init,
                headers: {
                    Authorization: `Bearer ${this.options.apiToken}`,
                    'Content-Type': 'application/json'
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT)
            });

            const raw = await response.text();
            let body: CloudflareEnvelope<T> | null = null;

            try {
                body = raw ? (JSON.parse(raw) as CloudflareEnvelope<T>) : null;
            } catch {
                body = null;
            }

            if (response.ok && body?.success) {
                return body.result;
            }

            const transient = response.status === 429 || response.status >= 500;
            const message =
                body?.errors?.map(error => `${error.code}: ${error.message}`).join('; ') ||
                `Cloudflare API returned HTTP ${response.status}`;

            if (transient && retryable && attempt < MAX_ATTEMPTS) {
                await sleep(RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]);
                return this.request<T>(url, init, attempt + 1);
            }

            throw new CloudflareDnsError(message, response.status, transient);
        } catch (err) {
            if (err instanceof CloudflareDnsError) {
                throw err;
            }

            const transient =
                err instanceof TypeError ||
                (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'));

            if (transient && retryable && attempt < MAX_ATTEMPTS) {
                await sleep(RETRY_DELAYS[attempt - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1]);
                return this.request<T>(url, init, attempt + 1);
            }

            throw err;
        }
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

export default CloudflareDns;
