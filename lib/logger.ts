type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogPayload {
  level: LogLevel;
  channel?: string;
  event?: string;
  [key: string]: any;
}

export const logger = {
  info: (payload: Omit<LogPayload, 'level'>) => log({ level: 'info', ...payload }),
  warn: (payload: Omit<LogPayload, 'level'>) => log({ level: 'warn', ...payload }),
  error: (payload: Omit<LogPayload, 'level'>) => log({ level: 'error', ...payload }),
  debug: (payload: Omit<LogPayload, 'level'>) => log({ level: 'debug', ...payload }),
};

function log(payload: LogPayload) {
  const logData = {
    timestamp: new Date().toISOString(),
    ...payload,
  };

  // Always output structured JSON to stdout/stderr
  if (payload.level === 'error') {
    console.error(JSON.stringify(logData));
  } else if (payload.level === 'warn') {
    console.warn(JSON.stringify(logData));
  } else if (payload.level === 'debug') {
    console.debug(JSON.stringify(logData));
  } else {
    console.log(JSON.stringify(logData));
  }
}
