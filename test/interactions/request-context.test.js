const express = require('express');
const request = require('supertest');
const requestContext = require('../../src/middlewares/request-context.middleware').default;
const { getRequestLogContext, setRequestUserId } = require('../../src/logs/context');

function buildApp() {
    const app = express();

    app.use(requestContext);
    app.get('/contexto', (req, res) => {
        setRequestUserId(42);
        res.json({ requestId: req.requestId, context: getRequestLogContext() });
    });

    return app;
}

describe('request-context middleware', () => {
    it('aceita x-request-id válido e propaga no AsyncLocalStorage', async () => {
        const res = await request(buildApp()).get('/contexto').set('x-request-id', 'abcdefgh');

        expect(res.headers['x-request-id']).toBe('abcdefgh');
        expect(res.body.requestId).toBe('abcdefgh');
        expect(res.body.context).toMatchObject({
            request_id: 'abcdefgh',
            method: 'GET',
            route: '/contexto',
            user_id: 42
        });
    });

    it('gera um request id quando o header é inválido', async () => {
        const res = await request(buildApp()).get('/contexto').set('x-request-id', 'curto');

        expect(res.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/i);
        expect(res.body.requestId).toBe(res.headers['x-request-id']);
    });
});
