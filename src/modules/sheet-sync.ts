import { io, type Socket } from 'socket.io-client';
import config from '../configs/config';
import db from '../configs/database';
import logger from '../configs/logger';
import SheetController from '../controllers/sheet.controller';
import sheetNameCache from '../resources/cache/sheet-name.cache';
import { deactivateIrtMessages, type IrtMessageRef } from '../resources/utils/irt';
import syncSheet from '../resources/utils/sync-sheet';
import takeOver from './take-over';

const RECONCILE_INTERVAL_MS = 30_000;
const RECONCILE_BATCH_SIZE = 5;
const CONNECT_ERROR_LOG_INTERVAL_MS = 60_000;

let socket: Socket | null = null;
let reconcileTimer: NodeJS.Timeout | null = null;
let isReconciling = false;
let reconcileCursor = 0;
let lastConnectErrorAt = 0;
const syncingSheets = new Set<number>();
const dirtySheets = new Set<number>();

interface SheetRealtimeEvent {
    resourceId: number;
    userId?: number;
    name?: string;
    irtSheets?: Array<{
        channelId?: string;
        channel_id?: string;
        messageId?: string;
        msg_id?: string;
    }>;
}

function isActiveInstance(): boolean {
    return config.INSTANCE_TYPE === 'primary' || takeOver.takingOver;
}

function readSheetEvent(value: unknown): SheetRealtimeEvent | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const event = value as SheetRealtimeEvent;
    const resourceId = Number(event.resourceId);
    const userId = event.userId === undefined ? undefined : Number(event.userId);

    if (!Number.isInteger(resourceId) || resourceId <= 0) {
        return null;
    }

    return {
        ...event,
        resourceId,
        userId: Number.isInteger(userId) && userId! > 0 ? userId : undefined
    };
}

function readIrtMessages(event: SheetRealtimeEvent): IrtMessageRef[] {
    if (!Array.isArray(event.irtSheets)) {
        return [];
    }

    const messages: IrtMessageRef[] = [];

    for (const entry of event.irtSheets) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }

        const channelId = entry.channelId ?? entry.channel_id;
        const messageId = entry.messageId ?? entry.msg_id;

        if (channelId && messageId) {
            messages.push({ channelId: `${channelId}`, messageId: `${messageId}` });
        }
    }

    return messages;
}

async function syncSheetById(sheetId: number): Promise<void> {
    if (!isActiveInstance()) {
        return;
    }

    if (syncingSheets.has(sheetId)) {
        dirtySheets.add(sheetId);
        return;
    }

    syncingSheets.add(sheetId);

    try {
        do {
            dirtySheets.delete(sheetId);

            const sheet = await SheetController.getById(sheetId);

            if (!sheet) {
                return;
            }

            const result = await syncSheet({ sheet });

            if (!result.skipped) {
                logger.info(
                    `IRT sync sheet ${sheetId}: ${result.updated} updated, ${result.failed} failed` +
                        (result.deactivated ? `, ${result.deactivated} deactivated` : ''),
                    {
                        event: 'sheet.sync',
                        sheet_id: sheetId,
                        sync_failures: result.failed
                    }
                );
            }
        } while (dirtySheets.has(sheetId));
    } catch (err) {
        logger.error(err, { event: 'sheet.sync.error', sheet_id: sheetId });
    } finally {
        syncingSheets.delete(sheetId);
        dirtySheets.delete(sheetId);
    }
}

async function reconcile(): Promise<void> {
    if (!isActiveInstance() || isReconciling) {
        return;
    }

    isReconciling = true;

    try {
        let rows = await db.$queryRaw<Array<{ sheet_id: number }>>`
            SELECT DISTINCT s.id AS sheet_id
            FROM sheets s
            INNER JOIN irt_sheets i ON i.sheet_id = s.id
            WHERE (i.last_synced_at IS NULL OR i.last_synced_at < s.last_use)
              AND s.id > ${reconcileCursor}
            ORDER BY s.id
            LIMIT ${RECONCILE_BATCH_SIZE}
        `;

        // Chegou ao fim da lista: volta ao começo no próximo ciclo. Isso
        // evita que cinco fichas com erro permanente bloqueiem para sempre
        // as fichas de IDs maiores.
        if (rows.length === 0 && reconcileCursor !== 0) {
            reconcileCursor = 0;
            rows = await db.$queryRaw<Array<{ sheet_id: number }>>`
                SELECT DISTINCT s.id AS sheet_id
                FROM sheets s
                INNER JOIN irt_sheets i ON i.sheet_id = s.id
                WHERE i.last_synced_at IS NULL OR i.last_synced_at < s.last_use
                ORDER BY s.id
                LIMIT ${RECONCILE_BATCH_SIZE}
            `;
        }

        for (const row of rows) {
            await syncSheetById(row.sheet_id);
        }

        if (rows.length > 0) {
            reconcileCursor = rows[rows.length - 1].sheet_id;
        }
    } catch (err) {
        logger.error(err, { event: 'sheet.reconcile.error' });
    } finally {
        isReconciling = false;
    }
}

function updateCache(event: SheetRealtimeEvent): void {
    if (event.userId === undefined || event.name === undefined) {
        return;
    }

    sheetNameCache.upsert(event.userId, event.resourceId, event.name);
}

function connect(): void {
    if (!config.BOT_SYNC_TOKEN) {
        logger.warn('BOT_SYNC_TOKEN is not configured; IRT realtime sync is disabled', {
            event: 'sheet.sync.disabled'
        });
        return;
    }

    try {
        socket = io(config.KAMI_SITE_URL, {
            path: '/socket.io',
            transports: ['websocket'],
            extraHeaders: {
                'x-kami-service-token': config.BOT_SYNC_TOKEN
            },
            auth: {
                rooms: ['service:sheets', 'service:users']
            }
        });
    } catch (err) {
        logger.error(err, { event: 'sheet.sync.connect_failed' });
        socket = null;
        return;
    }

    socket.on('connect', () => {
        logger.info(`Connected to Kami site Socket.IO at ${config.KAMI_SITE_URL}`, {
            event: 'sheet.sync.connected'
        });

        // Eventos perdidos durante uma queda de conexão não são reenviados;
        // recarrega o cache para não ficar com nomes antigos/ausentes.
        void sheetNameCache.loadCache().catch(err => {
            logger.error(err, { event: 'cache.sheet_names.reload_failed' });
        });

        void reconcile();
    });

    socket.on('connect_error', error => {
        const now = Date.now();

        if (now - lastConnectErrorAt < CONNECT_ERROR_LOG_INTERVAL_MS) {
            return;
        }

        lastConnectErrorAt = now;
        logger.warn(`Kami site Socket.IO connection error: ${error instanceof Error ? error.message : String(error)}`, {
            event: 'sheet.sync.connect_error',
            error
        });
    });

    socket.on('sheet.created', value => {
        const event = readSheetEvent(value);

        if (event) {
            updateCache(event);
        }
    });

    socket.on('sheet.updated', value => {
        const event = readSheetEvent(value);

        if (!event) {
            return;
        }

        updateCache(event);

        if (isActiveInstance()) {
            void syncSheetById(event.resourceId);
        }
    });

    socket.on('sheet.deleted', value => {
        const event = readSheetEvent(value);

        if (!event) {
            return;
        }

        if (event.userId !== undefined) {
            sheetNameCache.removeById(event.userId, event.resourceId);
        }

        const messages = readIrtMessages(event);

        if (messages.length > 0) {
            void deactivateIrtMessages(messages).catch(err => {
                logger.error(err, { event: 'sheet.sync.deactivate_failed', sheet_id: event.resourceId });
            });
        }
    });

    socket.on('user.merged', value => {
        if (!value || typeof value !== 'object') {
            return;
        }

        const event = value as { fromUserId?: unknown; toUserId?: unknown };
        const fromUserId = Number(event.fromUserId);
        const toUserId = Number(event.toUserId);

        if (Number.isInteger(fromUserId) && Number.isInteger(toUserId) && fromUserId > 0 && toUserId > 0) {
            sheetNameCache.moveUser(fromUserId, toUserId);
        }
    });
}

export function startSheetSync(): void {
    if (process.env.NODE_ENV === 'test') {
        return;
    }

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    connect();

    if (reconcileTimer) {
        clearInterval(reconcileTimer);
    }

    reconcileTimer = setInterval(() => {
        void reconcile();
    }, RECONCILE_INTERVAL_MS);

    void reconcile();
}

export function stopSheetSync(): void {
    if (reconcileTimer) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
    }

    socket?.disconnect();
    socket = null;
    syncingSheets.clear();
    dirtySheets.clear();
}
