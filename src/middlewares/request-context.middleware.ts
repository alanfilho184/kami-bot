import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequestLogContext } from '../logs/context';

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._-]{8,100}$/;

function getRequestId(req: Request): string {
    const received = req.get('x-request-id');

    if (received && REQUEST_ID_PATTERN.test(received)) {
        return received;
    }

    return randomUUID();
}

function normalizeRoute(req: Request): string {
    const route = req.originalUrl?.split('?')[0] ?? req.path ?? '/';

    return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
}

export default function requestContext(req: Request, res: Response, next: NextFunction): void {
    const requestId = getRequestId(req);

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    runWithRequestLogContext(
        {
            request_id: requestId,
            method: req.method,
            route: normalizeRoute(req),
            ip: req.ip ?? null,
            user_id: req.user?.id ?? null
        },
        () => next()
    );
}
