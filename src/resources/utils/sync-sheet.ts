import { buildSheetTooComplexContent, createSheetEmbed, SheetTooComplexError } from '../../commands/sheet/sheet-send';
import SheetController from '../../controllers/sheet.controller';
import rest from '../../configs/rest';
import { Routes } from 'discord-api-types/rest/v10';
import UserController from '../../controllers/user.controller';
import db from '../../configs/database';
import logger from '../../configs/logger';
import { Available_Languages } from '../../types/enums';
import { deactivateIrtSheets, isPermanentIrtError } from './irt';

export interface SyncSheetResult {
    updated: number;
    failed: number;
    skipped: boolean;
    deactivated?: number;
}

export const MAX_IRT_SYNC_FAILURES = 5;

const MAX_CONCURRENT_SYNCS = 2;

const sheetQueues = new Map<number, Promise<SyncSheetResult>>();
const waiters: Array<() => void> = [];
let activeSyncs = 0;

function withConcurrencySlot<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const run = () => {
            activeSyncs += 1;
            task()
                .then(resolve, reject)
                .finally(() => {
                    activeSyncs -= 1;
                    waiters.shift()?.();
                });
        };

        if (activeSyncs < MAX_CONCURRENT_SYNCS) {
            run();
        } else {
            waiters.push(run);
        }
    });
}

async function registerPermanentFailure(irtSheet: Irt_Sheet, sheetId: number): Promise<void> {
    const rows = await db.$queryRaw<Array<{ sync_failures: number }>>`
        UPDATE irt_sheets
        SET sync_failures = sync_failures + 1
        WHERE id = ${irtSheet.id}
        RETURNING sync_failures
    `;
    const row = rows[0];

    if (!row) {
        logger.warn(
            `IRT message ${irtSheet.msg_id} (sheet ${sheetId}) failed permanently and the link no longer exists.`,
            { event: 'sheet.sync.link_missing', sheet_id: sheetId }
        );
        return;
    }

    const failures = Number(row.sync_failures);

    if (failures < MAX_IRT_SYNC_FAILURES) {
        logger.warn(
            `IRT message ${irtSheet.msg_id} (sheet ${sheetId}) failed permanently; failure ${failures}/${MAX_IRT_SYNC_FAILURES}.`,
            { event: 'sheet.sync.message_missing', sheet_id: sheetId, sync_failures: failures }
        );
        return;
    }

    const removed = await db.$executeRaw`
        DELETE FROM irt_sheets
        WHERE id = ${irtSheet.id}
    `;

    logger.warn(
        removed > 0
            ? `IRT message ${irtSheet.msg_id} (sheet ${sheetId}) was removed after ${failures} consecutive failures.`
            : `IRT message ${irtSheet.msg_id} (sheet ${sheetId}) reached ${failures} failures but the link no longer existed.`,
        {
            event: removed > 0 ? 'sheet.sync.link_removed' : 'sheet.sync.link_missing',
            sheet_id: sheetId,
            sync_failures: failures
        }
    );
}

function isPending(
    irtSheet: Irt_Sheet,
    marker: { last_synced_at: Date | string | null } | undefined,
    sheetLastUse: Date
): boolean {
    if (!marker?.last_synced_at) {
        return true;
    }

    const syncedAt = new Date(marker.last_synced_at).getTime();
    const sheetAt = new Date(sheetLastUse).getTime();

    return !Number.isFinite(syncedAt) || syncedAt < sheetAt;
}

async function syncSheetNow(data: {
    sheet: Sheet;
    language?: Available_Languages;
    user?: User & User_Config;
}): Promise<SyncSheetResult> {
    try {
        let language: Available_Languages | null = null;
        let user: (User & User_Config) | null = null;

        if (data.language) {
            language = data.language as Available_Languages;
        }

        if (data.user) {
            user = data.user;
        } else {
            const userDb = await UserController.getById(data.sheet.user_id);

            if (userDb) {
                user = userDb;
            } else {
                logger.warn(
                    `User with ID ${data.sheet.user_id} not found in database while syncing sheet with ID ${data.sheet.id}.`,
                    {
                        event: 'sheet.sync.user_missing',
                        sheet_id: data.sheet.id,
                        sheet_owner_id: data.sheet.user_id
                    }
                );
                return { updated: 0, failed: 0, skipped: true };
            }
        }

        if (language == null) {
            // Usuário sem users_config (ex.: ficha editada direto no site)
            // não tem idioma salvo. Sem fallback, localization() devolveria
            // "Localization error" em todos os rótulos do embed.
            language = (user.language as Available_Languages) ?? Available_Languages['pt-br'];
        }

        let embeds;

        try {
            embeds = createSheetEmbed({ ...data.sheet, user }, language);
        } catch (err) {
            if (err instanceof SheetTooComplexError) {
                const irtSheets = (await SheetController.getIrtSheetBySheetId(data.sheet.id)) ?? [];
                const content = buildSheetTooComplexContent({ ...data.sheet, user }, language);

                if (irtSheets.length > 0) {
                    await deactivateIrtSheets(irtSheets, { content });
                }

                logger.warn(`IRT sync for sheet ${data.sheet.id} deactivated: sheet is too complex for Discord.`, {
                    event: 'sheet.sync.too_complex',
                    sheet_id: data.sheet.id,
                    sync_failures: irtSheets.length
                });

                return {
                    updated: 0,
                    failed: 0,
                    skipped: irtSheets.length === 0,
                    deactivated: irtSheets.length
                };
            }

            throw err;
        }

        const irtSheets = await SheetController.getIrtSheetBySheetId(data.sheet.id);
        const markers = await db.$queryRaw<Array<{ id: number; last_synced_at: Date | string | null }>>`
            SELECT id, last_synced_at
            FROM irt_sheets
            WHERE sheet_id = ${data.sheet.id}
        `;
        const markerById = new Map(markers.map(marker => [marker.id, marker]));
        const pending = (irtSheets ?? []).filter(irtSheet =>
            isPending(irtSheet, markerById.get(irtSheet.id), data.sheet.last_use)
        );

        if (pending.length === 0) {
            return { updated: 0, failed: 0, skipped: true };
        }

        let updated = 0;
        let failed = 0;

        for (let index = 0; index < pending.length; index += 1) {
            const irtSheet = pending[index];

            try {
                await rest.patch(Routes.channelMessage(`${irtSheet.channel_id}`, `${irtSheet.msg_id}`), {
                    body: {
                        embeds: embeds
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                await db.$executeRaw`
                    UPDATE irt_sheets
                    SET last_synced_at = ${data.sheet.last_use},
                        sync_failures = 0
                    WHERE id = ${irtSheet.id}
                `;

                updated += 1;
            } catch (err) {
                failed += 1;
                logger.error(err, {
                    event: 'sheet.sync.message_failed',
                    sheet_id: data.sheet.id,
                    channel_id: String(irtSheet.channel_id),
                    sync_failures: failed
                });

                if (isPermanentIrtError(err)) {
                    try {
                        await registerPermanentFailure(irtSheet, data.sheet.id);
                    } catch (failureError) {
                        logger.error(failureError, {
                            event: 'sheet.sync.failure_record_failed',
                            sheet_id: data.sheet.id
                        });
                    }
                }
            }

            if (index < pending.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }

        return { updated, failed, skipped: false };
    } catch (err) {
        logger.error(err, { event: 'sheet.sync.error', sheet_id: data.sheet.id });
        return { updated: 0, failed: 1, skipped: false };
    }
}

/**
 * Serializa sincronizações da mesma ficha e limita a concorrência global.
 * Assim um comando e um evento do site não aplicam embeds fora de ordem e
 * um burst de eventos não abre dezenas de PATCHs ao mesmo tempo.
 */
export default function syncSheet(data: {
    sheet: Sheet;
    language?: Available_Languages;
    user?: User & User_Config;
}): Promise<SyncSheetResult> {
    const sheetId = data.sheet.id;
    const previous =
        sheetQueues.get(sheetId) ??
        Promise.resolve<SyncSheetResult>({
            updated: 0,
            failed: 0,
            skipped: true
        });

    const next = previous.catch(() => undefined).then(() => withConcurrencySlot(() => syncSheetNow(data)));

    sheetQueues.set(sheetId, next);

    void next
        .finally(() => {
            if (sheetQueues.get(sheetId) === next) {
                sheetQueues.delete(sheetId);
            }
        })
        .catch(() => undefined);

    return next;
}
