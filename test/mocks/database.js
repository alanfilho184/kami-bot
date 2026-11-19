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
    resources: { findUnique: jest.fn(), findFirst: jest.fn() },
    announcement: { findMany: jest.fn() },
    announcements_seen: { findMany: jest.fn(), upsert: jest.fn() },
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $connect: jest.fn(),
    $transaction: jest.fn()
};

// `tx` é um objeto distinto de `db`: assim o teste garante que o código usa o
// escopo da transação (tx) e não o cliente global (db). Os acessos delegam
// para os mesmos spies, então as asserções existentes continuam válidas.
// Qualquer modelo que o código usar dentro da transação cai no `db`.
const tx = new Proxy(
    {
        $queryRaw: jest.fn((...args) => db.$queryRaw(...args)),
        $queryRawUnsafe: jest.fn((...args) => db.$queryRawUnsafe(...args)),
        $executeRaw: jest.fn((...args) => db.$executeRaw(...args)),
        users: db.users,
        sheets: db.sheets,
        irt_sheets: db.irt_sheets
    },
    {
        get(target, property) {
            return property in target ? target[property] : db[property];
        }
    }
);

db.$transaction.mockImplementation(async callback => callback(tx));

async function verifyConnection() {
    return undefined;
}

module.exports = db;
module.exports.default = db;
module.exports.verifyConnection = verifyConnection;
module.exports.tx = tx;
