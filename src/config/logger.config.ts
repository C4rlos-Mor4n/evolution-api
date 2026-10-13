import dayjs from 'dayjs';
import fs from 'fs';

import { configService, Log } from './env.config';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

const formatDateLog = (timestamp: number) =>
  dayjs(timestamp)
    .toDate()
    .toString()
    .replace(/\sGMT.+/, '');

enum Color {
  LOG = '\x1b[32m',
  INFO = '\x1b[34m',
  WARN = '\x1b[33m',
  ERROR = '\x1b[31m',
  DEBUG = '\x1b[36m',
  VERBOSE = '\x1b[37m',
  DARK = '\x1b[30m',
}

enum Command {
  RESET = '\x1b[0m',
  BRIGHT = '\x1b[1m',
  UNDERSCORE = '\x1b[4m',
}

enum Level {
  LOG = Color.LOG + '%s' + Command.RESET,
  DARK = Color.DARK + '%s' + Command.RESET,
  INFO = Color.INFO + '%s' + Command.RESET,
  WARN = Color.WARN + '%s' + Command.RESET,
  ERROR = Color.ERROR + '%s' + Command.RESET,
  DEBUG = Color.DEBUG + '%s' + Command.RESET,
  VERBOSE = Color.VERBOSE + '%s' + Command.RESET,
}

enum Type {
  LOG = 'LOG',
  WARN = 'WARN',
  INFO = 'INFO',
  DARK = 'DARK',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
  VERBOSE = 'VERBOSE',
}

enum Background {
  LOG = '\x1b[42m',
  INFO = '\x1b[44m',
  WARN = '\x1b[43m',
  DARK = '\x1b[40m',
  ERROR = '\x1b[41m',
  DEBUG = '\x1b[46m',
  VERBOSE = '\x1b[47m',
}

export class Logger {
  private readonly configService = configService;
  private context: string;

  constructor(context = 'Logger') {
    this.context = context;
  }

  private instance = null;

  public setContext(value: string) {
    this.context = value;
  }

  public setInstance(value: string) {
    this.instance = value;
  }

  // Call SDPs (WhatsApp Cloud API Calling) carry ICE credentials, DTLS fingerprints and IP candidates.
  // Event controllers log whole webhook payloads (LOG_LEVEL WEBHOOKS), so redact them here, once.
  // Returns the same reference when nothing had to be redacted.
  private static redactSdp(value: any, depth = 0): any {
    if (!value || typeof value !== 'object' || depth > 5) return value;
    // Buffers/typed arrays (media), errors and dates never contain an "sdp" key: do not walk them
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Error || value instanceof Date) {
      return value;
    }

    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((item) => {
        const redacted = Logger.redactSdp(item, depth + 1);
        if (redacted !== item) changed = true;
        return redacted;
      });
      return changed ? out : value;
    }

    let copy: Record<string, any> | null = null;
    for (const key of Object.keys(value)) {
      const current = value[key];
      const next = key === 'sdp' && typeof current === 'string' ? '[redacted]' : Logger.redactSdp(current, depth + 1);
      if (next !== current) {
        copy = copy ?? { ...value };
        copy[key] = next;
      }
    }
    return copy ?? value;
  }

  private console(value: any, type: Type) {
    value = Logger.redactSdp(value);
    const types: Type[] = [];

    this.configService.get<Log>('LOG').LEVEL.forEach((level) => types.push(Type[level]));

    const typeValue = typeof value;
    if (types.includes(type)) {
      if (configService.get<Log>('LOG').COLOR) {
        console.log(
          /*Command.UNDERSCORE +*/ Command.BRIGHT + Level[type],
          '[Evolution API]',
          Command.BRIGHT + Color[type],
          this.instance ? `[${this.instance}]` : '',
          Command.BRIGHT + Color[type],
          `v${packageJson.version}`,
          Command.BRIGHT + Color[type],
          process.pid.toString(),
          Command.RESET,
          Command.BRIGHT + Color[type],
          '-',
          Command.BRIGHT + Color.VERBOSE,
          `${formatDateLog(Date.now())}  `,
          Command.RESET,
          Color[type] + Background[type] + Command.BRIGHT,
          `${type} ` + Command.RESET,
          Color.WARN + Command.BRIGHT,
          `[${this.context}]` + Command.RESET,
          Color[type] + Command.BRIGHT,
          `[${typeValue}]` + Command.RESET,
          Color[type],
          typeValue !== 'object' ? value : '',
          Command.RESET,
        );
        typeValue === 'object' ? console.log(/*Level.DARK,*/ value, '\n') : '';
      } else {
        console.log(
          '[Evolution API]',
          this.instance ? `[${this.instance}]` : '',
          process.pid.toString(),
          '-',
          `${formatDateLog(Date.now())}  `,
          `${type} `,
          `[${this.context}]`,
          `[${typeValue}]`,
          value,
        );
      }
    }
  }

  public log(value: any) {
    this.console(value, Type.LOG);
  }

  public info(value: any) {
    this.console(value, Type.INFO);
  }

  public warn(value: any) {
    this.console(value, Type.WARN);
  }

  public error(value: any) {
    this.console(value, Type.ERROR);
  }

  public verbose(value: any) {
    this.console(value, Type.VERBOSE);
  }

  public debug(value: any) {
    this.console(value, Type.DEBUG);
  }

  public dark(value: any) {
    this.console(value, Type.DARK);
  }
}
