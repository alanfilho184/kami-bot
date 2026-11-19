const mockState = {
    emit: jest.fn(),
    close: jest.fn(),
    connect: jest.fn(),
    active: true,
    handlers: {}
};

jest.mock('socket.io-client', () => ({
    io: () => ({
        on: (event, handler) => {
            mockState.handlers[event] = handler;
        },
        get active() {
            return mockState.active;
        },
        emit: mockState.emit,
        close: mockState.close,
        connect: mockState.connect
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
        mockState.connect.mockClear();
        mockState.active = true;
        mockState.handlers = {};
    });

    afterEach(() => {
        jest.useRealTimers();
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

    it('chama onConnect em toda reconexão', () => {
        const onConnect = jest.fn();
        createClient({ onConnect });

        mockState.handlers.connect();
        mockState.handlers.disconnect('transport close');
        mockState.handlers.connect();

        expect(onConnect).toHaveBeenCalledTimes(2);
    });

    it('avisa onDisconnect com o motivo', () => {
        const onDisconnect = jest.fn();
        createClient({ onDisconnect });

        mockState.handlers.disconnect('io server disconnect');

        expect(onDisconnect).toHaveBeenCalledWith('io server disconnect');
    });

    describe('watchdog de reconexão', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        it('força socket.connect() quando o socket fica inativo após connect_error', () => {
            createClient({ reconnectWatchdogMs: 1000 });

            mockState.active = false;
            mockState.handlers.connect_error(new Error('unavailable'));

            expect(mockState.connect).not.toHaveBeenCalled();

            jest.advanceTimersByTime(1000);

            expect(mockState.connect).toHaveBeenCalledTimes(1);
        });

        it('não força reconexão enquanto o socket ainda está ativo', () => {
            createClient({ reconnectWatchdogMs: 1000 });

            mockState.handlers.disconnect('transport close');
            jest.advanceTimersByTime(3000);

            expect(mockState.connect).not.toHaveBeenCalled();
        });

        it('para o watchdog quando a conexão volta', () => {
            createClient({ reconnectWatchdogMs: 1000 });

            mockState.active = false;
            mockState.handlers.connect_error(new Error('unavailable'));
            mockState.handlers.connect();

            jest.advanceTimersByTime(5000);

            expect(mockState.connect).not.toHaveBeenCalled();
        });

        it('não reabre a conexão depois de close', async () => {
            const client = createClient({ reconnectWatchdogMs: 1000 });

            mockState.handlers.connect();

            const closing = client.close();
            await jest.advanceTimersByTimeAsync(250);
            await closing;

            mockState.handlers.disconnect('io client disconnect');
            jest.advanceTimersByTime(5000);

            expect(mockState.connect).not.toHaveBeenCalled();
            expect(mockState.close).toHaveBeenCalledTimes(1);
        });
    });

    it('fecha o socket e ignora novos eventos após close', async () => {
        const client = createClient();

        mockState.handlers.connect();
        await client.close();

        client.send('log-texto', { n: 1 });

        expect(mockState.close).toHaveBeenCalledTimes(1);
        expect(mockState.emit).not.toHaveBeenCalled();
        expect(client.pending()).toBe(0);
    });
});
