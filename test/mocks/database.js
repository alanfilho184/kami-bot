// Mock do Jest para src/configs/database (Prisma) (vive em test/mocks, fora do src).
// Uso em cada teste via factory explícita:
//   jest.mock('../../src/configs/database', () => require('../mocks/database'));
// (ajustar o relativo conforme a profundidade do teste).
const db = {
    users: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    users_config: { upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    logs: { create: jest.fn(), count: jest.fn() },
    sheets: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn()
    },
    irt_sheets: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn()
    },
    resources: { findUnique: jest.fn() },
    announcement: { findMany: jest.fn() },
    announcements_seen: { findMany: jest.fn(), upsert: jest.fn() },
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $connect: jest.fn()
};

async function verifyConnection() {
    return undefined;
}

module.exports = db;
module.exports.default = db;
module.exports.verifyConnection = verifyConnection;
