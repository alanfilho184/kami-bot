// Mock do Jest para src/configs/rest (vive em test/mocks, fora do src).
// Uso em cada teste via factory explícita (evita out-of-scope no hoist do jest.mock):
//   jest.mock('../../src/configs/rest', () => require('../mocks/rest'));
// (ajustar o relativo conforme a profundidade do teste).
const rest = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn()
};

export default rest;
