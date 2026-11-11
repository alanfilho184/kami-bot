import { Routes } from 'discord-api-types/v10';
import rest from '../../configs/rest';
import SheetController from '../../controllers/sheet.controller';
import logger from '../../configs/logger';

export interface IrtMessageRef {
    channelId: string;
    messageId: string;
}

export interface DeactivateIrtOptions {
    /** Texto que substitui o conteúdo da mensagem (ex.: aviso de ficha complexa). */
    content?: string;
    /** Intervalo entre patches para não estourar o rate limit do Discord. */
    delayMs?: number;
}

export const IRT_DEACTIVATE_DELAY_MS = 3000;

function readErrorCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const candidate = error as {
        code?: unknown;
        rawError?: { code?: unknown };
    };
    const code = candidate.code ?? candidate.rawError?.code;

    if (code === undefined || code === null) {
        return null;
    }

    const numeric = Number(code);

    return Number.isFinite(numeric) ? numeric : null;
}

function readErrorStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const status = (error as { status?: unknown }).status;

    if (status === undefined || status === null) {
        return null;
    }

    const numeric = Number(status);

    return Number.isFinite(numeric) ? numeric : null;
}

/** Erros que indicam que a mensagem/canal não existe mais no Discord. */
export function isMissingIrtMessageError(error: unknown): boolean {
    const code = readErrorCode(error);
    const status = readErrorStatus(error);

    return code === 10003 || code === 10008 || code === 404 || status === 404;
}

/** Erros permanentes que não vão se resolver em uma nova tentativa. */
export function isPermanentIrtError(error: unknown): boolean {
    const code = readErrorCode(error);
    const status = readErrorStatus(error);

    return (
        code === 10003 ||
        code === 10008 ||
        code === 50001 ||
        code === 403 ||
        code === 404 ||
        code === 400 ||
        status === 403 ||
        status === 404 ||
        status === 400
    );
}

function messageRoute(channelId: string, messageId: string): `/${string}` {
    return Routes.channelMessage(`${channelId}`, `${messageId}`) as `/${string}`;
}

async function patchMessage(channelId: string, messageId: string, body: Record<string, unknown>): Promise<boolean> {
    try {
        await rest.patch(messageRoute(channelId, messageId), {
            body,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        return true;
    } catch (err) {
        logger.warn(`Failed to deactivate IRT message ${messageId} in channel ${channelId}`, {
            event: 'sheet.sync.deactivate_failed',
            channel_id: channelId,
            error: err
        });

        return false;
    }
}

function deactivateBody(options: DeactivateIrtOptions): Record<string, unknown> {
    return {
        ...(options.content !== undefined ? { content: options.content, embeds: [] } : {}),
        components: []
    };
}

/** Remove o botão de sincronização de uma mensagem já existente. */
export async function deactivateIrtMessage(message: IrtMessageRef, options: DeactivateIrtOptions = {}): Promise<void> {
    await patchMessage(message.channelId, message.messageId, deactivateBody(options));
}

/**
 * Desativa um vínculo IRT do banco e remove o botão da mensagem.
 * A mensagem não é apagada: o usuário continua vendo o conteúdo atual.
 */
export async function deactivateIrtSheet(irtSheet: Irt_Sheet, options: DeactivateIrtOptions = {}): Promise<void> {
    const channelId = `${irtSheet.channel_id}`;
    const messageId = `${irtSheet.msg_id}`;

    await patchMessage(channelId, messageId, deactivateBody(options));
    await SheetController.deleteIrtSheetByMsgId(messageId);
}

export async function deactivateIrtSheets(irtSheets: Irt_Sheet[], options: DeactivateIrtOptions = {}): Promise<number> {
    const delayMs = options.delayMs ?? IRT_DEACTIVATE_DELAY_MS;

    for (let index = 0; index < irtSheets.length; index += 1) {
        await deactivateIrtSheet(irtSheets[index], options);

        if (index < irtSheets.length - 1 && delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return irtSheets.length;
}

/**
 * Remove o botão de mensagens cujos vínculos já foram apagados no banco
 * (ex.: quando o site apaga a ficha e emite `sheet.deleted`).
 */
export async function deactivateIrtMessages(
    messages: IrtMessageRef[],
    options: DeactivateIrtOptions = {}
): Promise<number> {
    const delayMs = options.delayMs ?? IRT_DEACTIVATE_DELAY_MS;

    for (let index = 0; index < messages.length; index += 1) {
        await deactivateIrtMessage(messages[index], options);

        if (index < messages.length - 1 && delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return messages.length;
}

/**
 * Verifica se as mensagens IRT ainda existem. Links de mensagens/canais
 * apagados são removidos para não ocuparem o limite de sincronizações.
 */
export async function pruneDeadIrtSheets(sheetId: number): Promise<number> {
    const irtSheets = (await SheetController.getIrtSheetBySheetId(sheetId)) ?? [];
    let removed = 0;

    for (const irtSheet of irtSheets) {
        try {
            await rest.get(messageRoute(`${irtSheet.channel_id}`, `${irtSheet.msg_id}`));
        } catch (err) {
            if (!isMissingIrtMessageError(err)) {
                continue;
            }

            await SheetController.deleteIrtSheetByMsgId(`${irtSheet.msg_id}`);
            removed += 1;

            logger.warn(`Removed dead IRT link for message ${irtSheet.msg_id} (sheet ${sheetId})`, {
                event: 'sheet.sync.link_pruned',
                sheet_id: sheetId,
                sync_failures: removed
            });
        }
    }

    return removed;
}
