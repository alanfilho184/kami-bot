jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
jest.mock('../../src/configs/database', () => require('../mocks/database'));

const appModule = require('../../src/app');
const app = appModule.default;
const { ready } = appModule;
const logger = require('../../src/configs/logger').default;
const rest = require('../../src/configs/rest').default;
const db = require('../../src/configs/database').default;
const { setupDefaultDbMocks, setupDefaultRestMocks, waitForCall } = require('../helpers/mock-factories');
const { buildCommandInteraction, postCommandAndWaitReply, waitAppReady } = require('../helpers/interaction-factory');

beforeAll(async () => {
    await waitAppReady();
    await ready;
});

beforeEach(() => {
    setupDefaultRestMocks(rest);
    setupDefaultDbMocks(db);
});

describe('log do comando', () => {
    it('envia logInteractionResult com execution_ms e evento do comando', async () => {
        const spy = jest.spyOn(logger, 'logInteractionResult');

        const res = await postCommandAndWaitReply(
            app,
            buildCommandInteraction({
                name: 'roll',
                options: [{ name: 'dice', type: 3, value: '1d20' }]
            })
        );

        expect(res.status).toBe(200);

        await waitForCall(spy, 1);

        const call = spy.mock.calls.find(entry => entry[1]?.event === 'discord.command');

        expect(call).toBeDefined();
        expect(call[1].execution_ms).toBeGreaterThanOrEqual(0);
        expect(typeof call[1].execution_ms).toBe('number');
    });
});
