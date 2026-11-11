export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export type IngestEventName = 'log-http' | 'log-ws' | 'log-ws-callback' | 'log-texto';

export interface RequestLogContext {
    request_id: string;
    method: string;
    route: string;
    ip: string | null;
    user_id: number | null;
}

export interface LogContext {
    event?: string;
    action?: string;
    user_id?: number | null;
    sheet_id?: number | null;
    sheet_name?: string | null;
    sheet_owner_id?: number | null;
    macro_id?: number | null;
    macro_name?: string | null;
    guild_id?: string | null;
    channel_id?: string | null;
    interaction_id?: string | null;
    interaction_type?: number;
    language?: string;
    command?: string;
    component?: string;
    args?: string;
    sync_failures?: number;
    instance_role?: string;
    failover_target?: string;
    dns_changed?: boolean;
    error_code?: string;
    error_name?: string;
    error?: unknown;
    execution_ms?: number | null;
    automatic?: boolean;
    notifyDiscord?: boolean;
    remote?: boolean;
    [key: string]: unknown;
}

export interface DiscordLogOptions {
    execution_ms: number | null;
    event: string;
    error?: unknown;
    remote?: boolean;
}

export interface LoggerClientOptions {
    url: string;
    token: string;
    instance: string;
    onError: (error: Error) => void;
    onConnect?: () => void;
    maxQueue?: number;
    maxQueueBytes?: number;
}

export interface LoggerClient {
    send(event: IngestEventName, payload: Record<string, unknown>): void;
    flush(timeoutMs?: number): Promise<void>;
    close(): Promise<void>;
    isConnected(): boolean;
    pending(): number;
}
