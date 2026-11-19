import logger from '../../configs/logger';

class ActionHandler {
    private actions: Map<
        string,
        { createdAt: Date; expireAt: Date; singleUse: boolean; respondOnlyToUserId?: string; run: Function }
    > = new Map();
    constructor() {
        const interval = setInterval(
            () => {
                this.clearExpiredActions();
            },
            10 * 60 * 1000
        );
        // Não segura o processo aberto (importante p/ o Jest encerrar limpo).
        (interval as unknown as { unref?: () => void }).unref?.();
    }

    registerAction(
        id: string,
        data: { action: Function; expireAt?: Date; singleUse?: boolean; respondOnlyToUserId?: string }
    ): void {
        const now = new Date();
        this.actions.set(id, {
            createdAt: now,
            expireAt: data.expireAt ? data.expireAt : new Date(now.getTime() + 18 * 60 * 1000),
            singleUse: data.singleUse ? true : false,
            run: data.action,
            respondOnlyToUserId: data.respondOnlyToUserId
        });
    }

    /**
     * Executa uma ação registrada.
     *
     * `run` é assíncrono: a rejeição precisa ser capturada explicitamente,
     * senão o `catch` (que só pega throws síncronos) nunca a vê e o erro
     * escapa sem chegar ao logger estruturado.
     *
     * Retorna `false` quando nenhuma ação foi executada (inexistente,
     * expirada, já usada ou pertencente a outro usuário) para que o chamador
     * responda a interação e o Discord não a reentregue.
     */
    async executeAction(id: string, userId: string, ...args: any[]): Promise<boolean> {
        const action = this.actions.get(id);

        if (!action) {
            return false;
        }

        if (action.expireAt <= new Date()) {
            this.deleteAction(id);
            return false;
        }

        if (action.respondOnlyToUserId && action.respondOnlyToUserId !== userId) {
            return false;
        }

        if (action.singleUse) {
            this.deleteAction(id);
        }

        try {
            await action.run(...args);
        } catch (err) {
            logger.error(err, { event: 'component.action.error', action: id });
            throw err;
        }

        return true;
    }

    deleteAction(id: string): void {
        this.actions.delete(id);
    }

    clearExpiredActions(): void {
        const now = new Date();
        this.actions.forEach((action, id) => {
            if (action.expireAt < now) {
                this.actions.delete(id);
            }
        });
    }
}

const actionHandler = new ActionHandler();

export default actionHandler;
