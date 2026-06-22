import { dbOps } from '../config/db-helpers.js';
import { isVerboseConsoleEnabled } from '../loadEnv.js';

const LOG_LEVELS: Record<string, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

const LOG_LEVEL_NAMES: Record<number, string> = {
  0: 'debug',
  1: 'info',
  2: 'warn',
  3: 'error',
};

interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data: Record<string, unknown>;
}

interface LogOptions {
  limit?: number;
  category?: string | null;
  level?: string | null;
}

class Logger {
  level: number;
  persistToDb: boolean;
  maxDbEntries: number;
  categories: Map<string, number>;
  listeners: Set<(entry: LogEntry) => void>;

  constructor() {
    this.level = isVerboseConsoleEnabled() ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
    this.persistToDb = true;
    this.maxDbEntries = 1000;
    this.categories = new Map();
    this.listeners = new Set();
  }

  setLevel(level: string | number): void {
    if (typeof level === 'string') {
      const levelUpper = level.toUpperCase();
      if (LOG_LEVELS[levelUpper] !== undefined) {
        this.level = LOG_LEVELS[levelUpper];
      }
    } else if (typeof level === 'number') {
      this.level = level;
    }
    console.log(`[Logger] Log level set to ${LOG_LEVEL_NAMES[this.level] || 'unknown'}`);
  }

  setCategoryLevel(category: string, level: string | number): void {
    if (typeof level === 'string') {
      const levelUpper = level.toUpperCase();
      if (LOG_LEVELS[levelUpper] !== undefined) {
        this.categories.set(category, LOG_LEVELS[levelUpper]);
      }
    } else if (typeof level === 'number') {
      this.categories.set(category, level);
    }
  }

  shouldLog(level: number, category: string | null = null): boolean {
    if (category && this.categories.has(category)) {
      return level >= (this.categories.get(category) ?? LOG_LEVELS.NONE);
    }
    return level >= this.level;
  }

  formatMessage(level: number, category: string, message: string, data: Record<string, unknown> = {}): LogEntry {
    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level] || 'unknown';

    return {
      timestamp,
      level: levelName,
      category,
      message,
      data,
    };
  }

  log(level: number, category: string, message: string, data: Record<string, unknown> = {}): void {
    if (!this.shouldLog(level, category)) {
      return;
    }

    const entry = this.formatMessage(level, category, message, data);

    const consoleMessage = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${category}] ${message}`;
    switch (level) {
      case LOG_LEVELS.DEBUG:
        console.debug(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
      case LOG_LEVELS.INFO:
        console.log(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
      case LOG_LEVELS.WARN:
        console.warn(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
      case LOG_LEVELS.ERROR:
        console.error(consoleMessage, Object.keys(data).length > 0 ? data : '');
        break;
    }

    if (this.persistToDb && level >= LOG_LEVELS.INFO) {
      try {
        dbOps.insertActivityLog(entry as unknown as Record<string, unknown>);
      } catch {}
    }

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {}
    }
  }

  debug(category: string, message: string, data: Record<string, unknown> = {}): void {
    this.log(LOG_LEVELS.DEBUG, category, message, data);
  }

  info(category: string, message: string, data: Record<string, unknown> = {}): void {
    this.log(LOG_LEVELS.INFO, category, message, data);
  }

  warn(category: string, message: string, data: Record<string, unknown> = {}): void {
    this.log(LOG_LEVELS.WARN, category, message, data);
  }

  error(category: string, message: string, data: Record<string, unknown> = {}): void {
    this.log(LOG_LEVELS.ERROR, category, message, data);
  }

  download(level: number, message: string, downloadId: string, data: Record<string, unknown> = {}): void {
    this.log(level, 'download', message, { downloadId, ...data });
  }

  library(level: number, message: string, data: Record<string, unknown> = {}): void {
    this.log(level, 'library', message, data);
  }

  discovery(level: number, message: string, data: Record<string, unknown> = {}): void {
    this.log(level, 'discovery', message, data);
  }

  api(level: number, message: string, data: Record<string, unknown> = {}): void {
    this.log(level, 'api', message, data);
  }

  slskd(level: number, message: string, data: Record<string, unknown> = {}): void {
    this.log(level, 'slskd', message, data);
  }

  system(level: number, message: string, data: Record<string, unknown> = {}): void {
    this.log(level, 'system', message, data);
  }

  addListener(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  removeListener(listener: (entry: LogEntry) => void): void {
    this.listeners.delete(listener);
  }

  getRecentLogs(options: LogOptions = {}): Record<string, unknown>[] {
    const { limit = 100, category = null, level = null } = options;
    return dbOps.getActivityLog(limit, category, level);
  }

  getLogStats(): Record<string, unknown> {
    const logs = dbOps.getActivityLog(1000);

    const byLevel: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    const byCategory: Record<string, number> = {};
    const lastHour = Date.now() - 60 * 60 * 1000;
    let recentCount = 0;

    for (const log of logs) {
      const logLevel = log.level as string;
      const logCategory = log.category as string;
      byLevel[logLevel] = (byLevel[logLevel] || 0) + 1;
      byCategory[logCategory] = (byCategory[logCategory] || 0) + 1;

      if (new Date(log.timestamp as string).getTime() > lastHour) {
        recentCount++;
      }
    }

    return {
      total: logs.length,
      lastHour: recentCount,
      byLevel,
      byCategory,
      currentLevel: LOG_LEVEL_NAMES[this.level],
      persistToDb: this.persistToDb,
    };
  }

  child(defaultCategory: string) {
    return {
      debug: (message: string, data: Record<string, unknown> = {}) => this.debug(defaultCategory, message, data),
      info: (message: string, data: Record<string, unknown> = {}) => this.info(defaultCategory, message, data),
      warn: (message: string, data: Record<string, unknown> = {}) => this.warn(defaultCategory, message, data),
      error: (message: string, data: Record<string, unknown> = {}) => this.error(defaultCategory, message, data),
      log: (level: number, message: string, data: Record<string, unknown> = {}) => this.log(level, defaultCategory, message, data),
    };
  }
}

export const logger = new Logger();

export const LOG_LEVELS_EXPORT = LOG_LEVELS;
