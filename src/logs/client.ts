import { io } from 'socket.io-client';
import type { IngestEventName, LoggerClient, LoggerClientOptions } from './types';

interface QueuedEvent {
    event: IngestEventName;
    payload: Record<string, unknown>;
    size: number;
}

const DEFAULT_RECONNECT_WATCHDOG_MS = 60_000;

function sleep(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function payloadSize(payload: Record<string, unknown>): number {
    try {
        return Buffer.byteLength(JSON.stringify(payload), 'utf8');
    } catch {
        return 1024;
    }
}

/**
 * Cliente de ingestão do kami-logger. A conexão é best-effort: enquanto o
 * logger está fora, os eventos ficam em uma fila limitada e os mais antigos
 * são descartados. Nada aqui pode bloquear ou derrubar uma requisição do bot.
 */
export function createLoggerClient(options: LoggerClientOptions): LoggerClient {
    const socket = io(options.url, {
        path: '/socket.io',
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        auth: { token: options.token },
        query: { instancia: options.instance }
    });

    const maxQueue = options.maxQueue ?? 1000;
    const maxQueueBytes = options.maxQueueBytes ?? 1024 * 1024;
    const reconnectWatchdogMs = options.reconnectWatchdogMs ?? DEFAULT_RECONNECT_WATCHDOG_MS;
    const queue: QueuedEvent[] = [];

    let connected = false;
    let closed = false;
    let queueBytes = 0;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

    function trimQueue(): void {
        while (queue.length > maxQueue || queueBytes > maxQueueBytes) {
            const removed = queue.shift();

            if (!removed) {
                break;
            }

            queueBytes -= removed.size;
        }
    }

    function reportError(error: unknown): void {
        options.onError(error instanceof Error ? error : new Error(String(error)));
    }

    function clearWatchdog(): void {
        if (!watchdogTimer) {
            return;
        }

        clearTimeout(watchdogTimer);
        watchdogTimer = null;
    }

    /**
     * O socket.io-client desiste de vez depois de um connect_error de namespace
     * (auth do logger) ou de um disconnect enviado pelo servidor: o socket é
     * destruído e socket.active fica false, mesmo com reconnectionAttempts
     * Infinity. Este watchdog reabre a conexão nesses casos.
     */
    function scheduleWatchdog(): void {
        if (closed || connected || watchdogTimer) {
            return;
        }

        watchdogTimer = setTimeout(() => {
            watchdogTimer = null;

            if (closed || connected) {
                return;
            }

            if (!socket.active) {
                try {
                    socket.connect();
                } catch (error) {
                    reportError(error);
                }
            }

            scheduleWatchdog();
        }, reconnectWatchdogMs);

        watchdogTimer.unref?.();
    }

    function emit(event: IngestEventName, payload: Record<string, unknown>): void {
        try {
            socket.emit(event, payload);
        } catch (error) {
            reportError(error);
        }
    }

    function drainQueue(): void {
        while (connected && queue.length > 0) {
            const item = queue.shift();

            if (!item) {
                break;
            }

            queueBytes -= item.size;
            emit(item.event, item.payload);
        }
    }

    socket.on('connect', () => {
        connected = true;
        clearWatchdog();
        drainQueue();

        if (options.onConnect) {
            options.onConnect();
        }
    });

    socket.on('disconnect', reason => {
        connected = false;

        // No close() do próprio cliente o motivo é "io client disconnect";
        // não vale registrar um disconnect operacional nesse caso.
        if (!closed) {
            options.onDisconnect?.(reason);
            scheduleWatchdog();
        }
    });

    socket.on('connect_error', error => {
        connected = false;
        reportError(error);
        scheduleWatchdog();
    });

    function send(event: IngestEventName, payload: Record<string, unknown>): void {
        if (closed) {
            return;
        }

        const size = payloadSize(payload);
        queue.push({ event, payload, size });
        queueBytes += size;

        if (connected) {
            drainQueue();
            return;
        }

        trimQueue();
    }

    async function flush(timeoutMs = 2000): Promise<void> {
        if (closed) {
            return;
        }

        // Se o logger caiu e o socket está desconectado, tenta reconectar
        // durante o flush. Sem isso, close() descartava a fila em silêncio.
        if (!connected) {
            try {
                socket.connect();
            } catch (error) {
                reportError(error);
                return;
            }

            const startedAt = Date.now();

            while (!connected && queue.length > 0 && Date.now() - startedAt < timeoutMs) {
                await sleep(50);
            }
        }

        drainQueue();

        if (connected) {
            // O logger grava em lotes de até 200 ms; dá tempo do último lote sair.
            await sleep(250);
        }
    }

    async function close(): Promise<void> {
        if (closed) {
            return;
        }

        await flush();

        const dropped = queue.length;

        closed = true;
        clearWatchdog();
        connected = false;
        queue.length = 0;
        queueBytes = 0;
        socket.close();

        if (dropped > 0) {
            console.warn(`[logger] closing with ${dropped} pending event(s); they were discarded`);
        }
    }

    return {
        send,
        flush,
        close,
        isConnected: () => connected,
        pending: () => queue.length
    };
}
