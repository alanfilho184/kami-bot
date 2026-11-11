import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestLogContext } from './types';

const storage = new AsyncLocalStorage<RequestLogContext>();

export function runWithRequestLogContext<T>(context: RequestLogContext, callback: () => T): T {
    return storage.run(context, callback);
}

export function getRequestLogContext(): RequestLogContext | undefined {
    return storage.getStore();
}

export function setRequestUserId(userId: number | null): void {
    const context = storage.getStore();

    if (context) {
        context.user_id = userId;
    }
}
