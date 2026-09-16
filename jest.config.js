module.exports = {
    transform: {
        '^.+\\.(t|j)sx?$': '@swc/jest'
    },
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    setupFiles: ['<rootDir>/test/helpers/setup.js'],
    testTimeout: 20000,
    // Limpa chamadas entre testes sem apagar implementações (mockClear, não mockReset).
    clearMocks: true,

    // Cobertura: provider "v8" funciona com o transform @swc/jest
    // (o provider "babel" padrão não instrumenta arquivos transpilados pelo SWC).
    // `npm test` continua sem cobertura (rápido); use `npm run test:coverage`.
    coverageProvider: 'v8',
    collectCoverageFrom: ['src/**/*.ts', '!src/types/**'],
    coverageDirectory: '<rootDir>/coverage',
    coverageReporters: ['text', 'lcov'],
    // Trava o mínimo de 70% (statements/lines) para comandos e componentes.
    // O padrão é glob casado contra o caminho do arquivo.
    coverageThreshold: {
        '**/src/commands/**/*.ts': { statements: 70, lines: 70 },
        '**/src/components/**/*.ts': { statements: 70, lines: 70 }
    }
};
