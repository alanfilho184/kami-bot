const mockState = {
    emit: jest.fn(),
    close: jest.fn(),
    handlers: {}
};

jest.mock('socket.io-client', () => ({
    io: () => ({
        on: (event, handler) => {
            mockState.handlers[event] = handler;
        },
        emit: mockState.emit,
        close: mockState.close
    })
}));

const { createLoggerClient } = require('../../src/logs/client');

function createClient(overrides = {}) {
    return createLoggerClient({
        url: 'https://logger.example.com',
        token: `klp_${'x'.repeat(32)}`,
        instance: 'test-instance',
        onError: jest.fn(),
        ...overrides
    });
}

describe('logs/client', () => {
    beforeEach(() => {
        mockState.emit.mockClear();
        mockState.close.mockClear();
        mockState.handlers = {};
    });

    it('enfileira enquanto desconectado e envia ao conectar', () => {
        const client = createClient();

        client.send('log-texto', { mensagem: 'antes' });

        expect(mockState.emit).not.toHaveBeenCalled();
        expect(client.pending()).toBe(1);

        mockState.handlers.connect();

        expect(mockState.emit).toHaveBeenCalledWith('log-texto', { mensagem: 'antes' });
        expect(client.pending()).toBe(0);
        expect(client.isConnected()).toBe(true);
    });

    it('descarta os eventos mais antigos ao estourar a fila', () => {
        const client = createClient({ maxQueue: 2 });

        client.send('log-texto', { n: 1 });
        client.send('log-texto', { n: 2 });
        client.send('log-texto', { n: 3 });

        expect(client.pending()).toBe(2);

        mockState.handlers.connect();

        expect(mockState.emit.mock.calls.map(call => call[1])).toEqual([{ n: 2 }, { n: 3 }]);
    });

    it('envia direto quando conectado e reporta connect_error', () => {
        const onError = jest.fn();
        const client = createClient({ onError });

        mockState.handlers.connect();
        client.send('log-texto', { event: 'discord.command' });

        expect(mockState.emit).toHaveBeenCalledWith('log-texto', { event: 'discord.command' });

        mockState.handlers.connect_error(new Error('offline'));

        expect(onError).toHaveBeenCalledTimes(1);
        expect(client.isConnected()).toBe(false);
    });

    it('chama onConnect apenas no evento de conexão', () => {
        const onConnect = jest.fn();
        createClient({ onConnect });

        mockState.handlers.connect();

        expect(onConnect).toHaveBeenCalledTimes(1);
    });

    it('fecha o socket e ignora novos eventos após close', async () => {
        const client = createClient();

        await client.close();
        client.send('log-texto', { n: 1 });

        expect(mockState.close).toHaveBeenCalledTimes(1);
        expect(mockState.emit).not.toHaveBeenCalled();
        expect(client.pending()).toBe(0);
    });
});
