const { Interaction } = require('../../src/resources/utils/interaction-handler');
const { buildCommandInteraction } = require('../helpers/interaction-factory');

function buildInteraction() {
    return new Interaction(buildCommandInteraction({ name: 'roll' }), { json: jest.fn() });
}

describe('Interaction command timer', () => {
    it('mede o tempo do comando e zera o contador', async () => {
        const int = buildInteraction();

        int.startCommandTimer();
        await new Promise(resolve => setTimeout(resolve, 20));

        const executionMs = int.stopCommandTimer();

        expect(executionMs).toBeGreaterThanOrEqual(10);
        expect(int.stopCommandTimer()).toBeNull();
    });

    it('devolve null quando o timer nunca foi iniciado', () => {
        const int = buildInteraction();

        expect(int.stopCommandTimer()).toBeNull();
    });
});
