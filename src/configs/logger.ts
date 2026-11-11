import LogHandler from '../logs/index';

const logger: Logger =
    process.env.NODE_ENV === 'test'
        ? {
              logText: () => undefined,
              info: () => undefined,
              warn: () => undefined,
              error: () => undefined,
              logTexto: () => undefined,
              logDiscord: async () => undefined,
              logInteractionResult: () => undefined,
              setUserId: () => undefined,
              flush: async () => undefined,
              close: async () => undefined
          }
        : new LogHandler();

export default logger;
