import LogHandler from '../logs/index';

const logger: Logger =
    process.env.NODE_ENV === 'test'
        ? {
              logFile: '',
              logHttp: () => undefined,
              logText: () => undefined,
              logDiscord: async () => undefined,
              getLog: () => false
          }
        : new LogHandler();

export default logger;
