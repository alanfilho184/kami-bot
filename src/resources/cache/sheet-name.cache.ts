import SheetController from '../../controllers/sheet.controller';
import logger from '../../configs/logger';

class SheetNameCache {
    /**
     * userId -> (sheetId -> sheetName).
     *
     * O id da ficha é necessário porque o site também cria/renomeia/apaga
     * fichas. Os eventos do Socket.IO trazem `resourceId` e `name`, então o
     * cache pode ser atualizado sem consultar o banco a cada alteração.
     */
    private cache: Map<number, Map<number, string>> = new Map();

    /**
     * Nomes adicionados sem id (compatibilidade com chamadas antigas e
     * testes). Não são usados pelo caminho do site, que sempre tem o id.
     */
    private namesWithoutId: Map<number, Set<string>> = new Map();

    async loadCache() {
        let executionTime = new Date().getTime();

        const sheets: Sheet_Head[] | null = await SheetController.getAllSheetsHead();
        if (!sheets) {
            return;
        }

        this.cache.clear();
        this.namesWithoutId.clear();

        for (let sheet of sheets) {
            this.upsert(sheet.user_id, sheet.id, sheet.sheet_name);
        }

        executionTime = new Date().getTime() - executionTime;
        logger.info(`Sheet names cache loaded in ${executionTime}ms`, {
            event: 'cache.sheet_names.loaded',
            execution_ms: executionTime
        });
    }

    get(userId: number): Array<string> | null {
        const byId = this.cache.get(userId);
        const withoutId = this.namesWithoutId.get(userId);

        if ((!byId || byId.size === 0) && (!withoutId || withoutId.size === 0)) {
            return null;
        }

        const names = new Set<string>();

        if (byId) {
            for (const name of byId.values()) {
                names.add(name);
            }
        }

        if (withoutId) {
            for (const name of withoutId) {
                names.add(name);
            }
        }

        return names.size > 0 ? [...names] : null;
    }

    add(userId: number, sheetName: string, sheetId?: number) {
        if (sheetId !== undefined && sheetId !== null) {
            this.upsert(userId, sheetId, sheetName);
            return;
        }

        if (!this.namesWithoutId.has(userId)) {
            this.namesWithoutId.set(userId, new Set());
        }

        this.namesWithoutId.get(userId)!.add(sheetName);
    }

    upsert(userId: number, sheetId: number, sheetName: string) {
        if (!this.cache.has(userId)) {
            this.cache.set(userId, new Map());
        }

        this.cache.get(userId)!.set(sheetId, sheetName);

        // Um nome que antes era "anônimo" agora tem id; evita duplicidade.
        this.namesWithoutId.get(userId)?.delete(sheetName);
    }

    remove(userId: number, sheetName: string) {
        const byId = this.cache.get(userId);

        if (byId) {
            for (const [sheetId, name] of byId) {
                if (name === sheetName) {
                    byId.delete(sheetId);
                }
            }
        }

        this.namesWithoutId.get(userId)?.delete(sheetName);
    }

    removeById(userId: number, sheetId: number) {
        this.cache.get(userId)?.delete(sheetId);
    }

    rename(userId: number, oldSheetName: string, newSheetName: string) {
        const byId = this.cache.get(userId);

        if (byId) {
            for (const [sheetId, name] of byId) {
                if (name === oldSheetName) {
                    byId.set(sheetId, newSheetName);
                }
            }
        }

        const withoutId = this.namesWithoutId.get(userId);

        if (withoutId?.delete(oldSheetName)) {
            withoutId.add(newSheetName);
        }
    }

    /** Move as fichas de um usuário para outro (merge de contas do site). */
    moveUser(fromUserId: number, toUserId: number) {
        if (fromUserId === toUserId) {
            return;
        }

        const from = this.cache.get(fromUserId);
        const fromWithoutId = this.namesWithoutId.get(fromUserId);

        if (!from && !fromWithoutId) {
            return;
        }

        if (!this.cache.has(toUserId)) {
            this.cache.set(toUserId, new Map());
        }

        const to = this.cache.get(toUserId)!;

        if (from) {
            for (const [sheetId, name] of from) {
                to.set(sheetId, name);
            }
        }

        if (fromWithoutId) {
            if (!this.namesWithoutId.has(toUserId)) {
                this.namesWithoutId.set(toUserId, new Set());
            }

            const toWithoutId = this.namesWithoutId.get(toUserId)!;

            for (const name of fromWithoutId) {
                toWithoutId.add(name);
            }
        }

        this.cache.delete(fromUserId);
        this.namesWithoutId.delete(fromUserId);
    }
}

const sheetNameCache = new SheetNameCache();

export default sheetNameCache;
