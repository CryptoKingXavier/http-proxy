
/**
 * ============================================================================
 * HTTP OBSERVABILITY LOGGER
 * ============================================================================
 *
 * @module Logger
 * @description
 * Production-oriented HTTP access and application logger for native Node.js.
 *
 * OBSERVABILITY CATEGORIES:
 *
 * 1. Request Identification
 * 2. Client Metadata
 * 3. Request Details
 * 4. Response Details
 * 5. Performance Metrics
 * 6. Connection Diagnostics
 * 7. Error Diagnostics
 *
 * FEATURES:
 * - Native Node.js HTTP request/response monitoring.
 * - Structured JSON and human-readable logging.
 * - Configurable log levels and output destinations.
 * - Request correlation IDs.
 * - Request and response lifecycle monitoring.
 * - Request duration measurement.
 * - Client and connection metadata.
 * - Safe request-header allowlisting.
 * - Query-string redaction by default.
 * - Asynchronous, ordered file writes.
 * - Automatic log directory creation.
 * - Graceful filesystem error handling.
 *
 * DEPENDENCIES: Node.js built-in modules only.
 * ============================================================================
 */

import type {
  IncomingMessage,
  ServerResponse,
} from 'node:http';

import { randomUUID } from 'node:crypto';

import {
  appendFile,
  mkdir,
} from 'node:fs/promises';

import {
  dirname,
  resolve,
} from 'node:path';

// ============================================================================
// 1. ENUMERATIONS
// ============================================================================

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export enum LogFormat {
  PRETTY = 'pretty',
  JSON = 'json',
}

export type LogDestination =
  | 'console'
  | 'file'
  | 'both';

// ============================================================================
// 2. CONFIGURATION INTERFACES
// ============================================================================

export interface LoggerOptions {
  level?: LogLevel;
  destination?: LogDestination;
  format?: LogFormat;

  directory?: string;
  filename?: string;

  includeQuery?: boolean;
  exposeRequestId?: boolean;
  includeUserAgent?: boolean;
  includeIp?: boolean;

  colors?: boolean;
  createDirectory?: boolean;
}

interface ResolvedLoggerOptions {
  level: LogLevel;
  destination: LogDestination;
  format: LogFormat;

  directory: string;
  filename: string;

  includeQuery: boolean;
  exposeRequestId: boolean;
  includeUserAgent: boolean;
  includeIp: boolean;

  colors: boolean;
  createDirectory: boolean;
}

// ============================================================================
// 3. OBSERVABILITY DATA INTERFACES
// ============================================================================

/**
 * Request identification and routing information.
 */
export interface RequestMetadata {
  requestId: string;
  timestamp: string;
  method: string;
  url: string;
  originalUrl: string;
  path: string;
  query?: Record<string, string>;
  httpVersion: string;
  host: string;
  protocol: 'http' | 'https';
  hostname: string;
}

/**
 * Client identification and browser information.
 */
export interface ClientMetadata {
  ip?: string | undefined;
  userAgent?: string | undefined;
  referer: string | null;
  origin: string | null;
  accept: string | null;
  acceptLanguage: string | null;
  acceptEncoding: string | null;
  remotePort: number | undefined;
}

/**
 * Incoming request information.
 *
 * Headers are intentionally allowlisted to prevent
 * accidental exposure of credentials and cookies.
 */
export interface RequestDetails {
  headers: Record<string, string>;
  contentType: string | null;
  contentLength: number | null;
}

/**
 * Outgoing response information.
 */
export interface ResponseDetails {
  statusCode: number;
  statusMessage: string;
  contentType: string | null;
  contentLength: number | null;
  headersSent: boolean;
  finished: boolean;
  connectionAborted: boolean;
}

/**
 * Request performance measurements.
 */
export interface PerformanceMetrics {
  duration: number;
  timeToFirstByte: null;
}

/**
 * Network and socket information.
 */
export interface ConnectionDiagnostics {
  remoteAddress: string | undefined;
  remotePort: number | undefined;
  localAddress: string | undefined;
  localPort: number | undefined;
  encrypted: boolean;
  keepAlive: boolean;
  socketBytesRead: number;
  socketBytesWritten: number;
}

/**
 * Error diagnostics.
 */
export interface ErrorDiagnostics {
  occurred: boolean;
  name?: string;
  message?: string;
  stackTrace?: string;
}

/**
 * Complete HTTP access log.
 */
export interface AccessLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;

  request: RequestMetadata;
  client: ClientMetadata;
  requestDetails: RequestDetails;
  response: ResponseDetails;
  performance: PerformanceMetrics;
  connection: ConnectionDiagnostics;
  error: ErrorDiagnostics;
}

/**
 * General application log entry.
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Application error logging options.
 */
export interface ErrorLogOptions {
  message: string;
  error?: unknown;
  context?: Record<string, unknown>;
}

// ============================================================================
// 4. CONSTANTS AND DEFAULT CONFIGURATION
// ============================================================================

const LOG_WEIGHTS: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
};

const ANSI_COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
} as const;

const DEFAULT_OPTIONS: ResolvedLoggerOptions = {
  level: LogLevel.DEBUG,
  destination: 'both',
  format: LogFormat.PRETTY,

  directory: 'logs',
  filename: 'access.log',

  includeQuery: false,
  exposeRequestId: true,
  includeUserAgent: true,
  includeIp: true,

  colors: true,
  createDirectory: true,
};

/**
 * Only explicitly approved request headers are recorded.
 *
 * Never add authorization, cookie or set-cookie headers here.
 */
const SAFE_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'accept-encoding',
  'content-type',
  'content-length',
  'host',
] as const;

// ============================================================================
// 5. LOGGER CLASS
// ============================================================================

export class Logger {

  private readonly options: ResolvedLoggerOptions;

  private readonly logFile: string;

  private writeQueue: Promise<void> = Promise.resolve();

  private initialized = false;

  // ========================================================================
  // 5.1 CONSTRUCTOR
  // ========================================================================

  constructor(options: LoggerOptions = {}) {

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.logFile = resolve(
      this.options.directory,
      this.options.filename,
    );
  }

  // ========================================================================
  // 5.2 INITIALIZATION
  // ========================================================================

  /**
   * Prepares the configured logging destination.
   *
   * Must be called before writing to the log file.
   */
  public async initialize(): Promise<void> {

    if (this.initialized) {
      return;
    }

    if (
      this.options.destination === 'file' ||
      this.options.destination === 'both'
    ) {

      if (this.options.createDirectory) {

        await mkdir(dirname(this.logFile), {
          recursive: true,
        });

      }

    }

    this.initialized = true;

    this.info('Logger initialized', {
      destination: this.options.destination,
      format: this.options.format,
      level: this.options.level,
      logFile: this.logFile,
    });
  }

  // ========================================================================
  // 5.3 LOG LEVEL FILTERING
  // ========================================================================

  private shouldLog(level: LogLevel): boolean {

    return (
      LOG_WEIGHTS[level] >=
      LOG_WEIGHTS[this.options.level]
    );
  }

  // ========================================================================
  // 5.4 SERIALIZATION ENGINE
  // ========================================================================

  /**
   * Serializes log records into JSON or human-readable output.
   *
   * Unlike a basic serializer, this method preserves all
   * additional observability properties.
   */
  private serialize(
    entry: Record<string, unknown>,
  ): string {

    if (this.options.format === LogFormat.JSON) {

      return JSON.stringify(entry);
    }

    const {
      timestamp,
      level,
      message,
      ...metadata
    } = entry;

    return (
      `[${timestamp}] ` +
      `[${level}] ` +
      `${message}` +
      ` ${JSON.stringify(metadata)}`
    );
  }

  // ========================================================================
  // 5.5 CONSOLE OUTPUT
  // ========================================================================

  private getColor(level: LogLevel): string {

    switch (level) {

      case LogLevel.DEBUG:
        return ANSI_COLORS.gray;

      case LogLevel.INFO:
        return ANSI_COLORS.green;

      case LogLevel.WARN:
        return ANSI_COLORS.yellow;

      case LogLevel.ERROR:
        return ANSI_COLORS.red;

      default:
        return ANSI_COLORS.reset;
    }
  }

  private writeToConsole(
    entry: Record<string, unknown>,
    serialized: string,
  ): void {

    const level = entry.level as LogLevel;

    const output = this.options.colors
      ? `${this.getColor(level)}${serialized}${ANSI_COLORS.reset}`
      : serialized;

    switch (level) {

      case LogLevel.ERROR:
        console.error(output);
        break;

      case LogLevel.WARN:
        console.warn(output);
        break;

      case LogLevel.DEBUG:
        console.debug(output);
        break;

      default:
        console.info(output);
        break;
    }
  }

  // ========================================================================
  // 5.6 FILE OUTPUT
  // ========================================================================

  /**
   * Queues file writes to preserve their order.
   */
  private writeToFile(serialized: string): void {

    if (!this.initialized) {

      console.error(
        '[LOGGER] Initialize the logger before writing to files.',
      );

      return;
    }

    this.writeQueue = this.writeQueue
      .then(async () => {

        await appendFile(
          this.logFile,
          `${serialized}\n`,
          'utf8',
        );

      })
      .catch((error: unknown) => {

        console.error(
          '[LOGGER] File write failed:',
          error,
        );

      });
  }

  // ========================================================================
  // 5.7 CENTRAL LOGGING ENGINE
  // ========================================================================

  /**
   * Handles routing, filtering and serialization of log entries.
   */
  private emit(
    entry: Record<string, unknown>,
    level: LogLevel,
  ): void {

    if (!this.shouldLog(level)) {
      return;
    }

    const serialized = this.serialize(entry);

    if (
      this.options.destination === 'console' ||
      this.options.destination === 'both'
    ) {

      this.writeToConsole(entry, serialized);
    }

    if (
      this.options.destination === 'file' ||
      this.options.destination === 'both'
    ) {

      this.writeToFile(serialized);
    }
  }

  // ========================================================================
  // 5.8 APPLICATION LOGGING METHODS
  // ========================================================================

  public log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {

    this.emit({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context && { context }),
    }, level);
  }

  public debug(
    message: string,
    context?: Record<string, unknown>,
  ): void {

    this.log(LogLevel.DEBUG, message, context);
  }

  public info(
    message: string,
    context?: Record<string, unknown>,
  ): void {

    this.log(LogLevel.INFO, message, context);
  }

  public warn(
    message: string,
    context?: Record<string, unknown>,
  ): void {

    this.log(LogLevel.WARN, message, context);
  }

  public error(options: ErrorLogOptions): void {

    const error = options.error;

    const errorDetails: Record<string, unknown> = {};

    if (error instanceof Error) {

      errorDetails.error = {
        name: error.name,
        message: error.message,
        stackTrace: error.stack,
      };

    } else if (error !== undefined) {

      errorDetails.error = String(error);
    }

    this.log(
      LogLevel.ERROR,
      options.message,
      {
        ...options.context,
        ...errorDetails,
      },
    );
  }

  // ========================================================================
  // 6. HTTP OBSERVABILITY HELPERS
  // ========================================================================

  /**
   * Returns an HTTP header as a string.
   */
  private getHeader(
    req: IncomingMessage,
    name: string,
  ): string | null {

    const value = req.headers[name.toLowerCase()];

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    return value ?? null;
  }

  /**
   * Extracts a numeric Content-Length value.
   *
   * This is the declared size, not a measurement of
   * the actual bytes consumed from the request stream.
   */
  private getContentLength(
    value: string | null,
  ): number | null {

    if (value === null) {
      return null;
    }

    const parsed = Number(value);

    return (
      Number.isSafeInteger(parsed) &&
      parsed >= 0
    ) ? parsed : null;
  }

  /**
   * Extracts the HTTP request URL.
   */
  private getUrl(
    req: IncomingMessage,
  ): {
    originalUrl: string;
    url: string;
    path: string;
    hostname: string;
    query?: Record<string, string>;
  } {

    const originalUrl = req.url ?? '/';

    let parsed: URL;

    try {

      parsed = new URL(
        originalUrl,
        `http://${req.headers.host ?? 'localhost'}`,
      );

    } catch {

      parsed = new URL('http://localhost/');
    }

    const query = this.options.includeQuery
      ? Object.fromEntries(
        parsed.searchParams.entries(),
      )
      : undefined;

    return {
      originalUrl,
      url: this.options.includeQuery
        ? originalUrl
        : parsed.pathname,
      path: parsed.pathname,
      hostname: parsed.hostname,
      ...(query && { query }),
    };
  }

  /**
   * Extracts approved request headers only.
   */
  private getSafeHeaders(
    req: IncomingMessage,
  ): Record<string, string> {

    const headers: Record<string, string> = {};

    for (const name of SAFE_REQUEST_HEADERS) {

      const value = this.getHeader(req, name);

      if (value !== null) {
        headers[name] = value;
      }
    }

    return headers;
  }

  /**
   * Determines whether the connection uses TLS.
   */
  private isEncrypted(req: IncomingMessage): boolean {

    return 'encrypted' in req.socket &&
      req.socket.encrypted === true;
  }

  // ========================================================================
  // 7. HTTP REQUEST OBSERVABILITY
  // ========================================================================

  /**
   * Registers HTTP request and response lifecycle monitoring.
   *
   * Call this once for every incoming request.
   *
   * Logs are generated after the response completes or
   * when its connection terminates prematurely.
   */
  public request(
    req: IncomingMessage,
    res: ServerResponse,
  ): void {

    const startTime = process.hrtime.bigint();

    const requestId = randomUUID();

    const timestamp = new Date().toISOString();

    let finalized = false;

    let capturedError: Error | undefined;

    const encrypted = this.isEncrypted(req);

    const socket = req.socket;

    const urlData = this.getUrl(req);

    // ------------------------------------------------------------
    // 7.1 REQUEST IDENTIFICATION
    // ------------------------------------------------------------

    const request: RequestMetadata = {
      requestId,
      timestamp,

      method: req.method ?? 'UNKNOWN',

      url: urlData.url,
      originalUrl: urlData.originalUrl,
      path: urlData.path,

      ...(urlData.query && {
        query: urlData.query,
      }),

      httpVersion: req.httpVersion,

      host: this.getHeader(req, 'host') ?? 'unknown',

      protocol: encrypted ? 'https' : 'http',

      hostname: urlData.hostname,
    };

    // ------------------------------------------------------------
    // 7.2 CLIENT METADATA
    // ------------------------------------------------------------

    const client: ClientMetadata = {
      ...(this.options.includeIp && {
        ip: socket.remoteAddress,
      }),

      ...(this.options.includeUserAgent && {
        userAgent: this.getHeader(req, 'user-agent') ?? 'unknown',
      }),

      referer: this.getHeader(req, 'referer'),
      origin: this.getHeader(req, 'origin'),

      accept: this.getHeader(req, 'accept'),
      acceptLanguage: this.getHeader(req, 'accept-language'),
      acceptEncoding: this.getHeader(req, 'accept-encoding'),

      remotePort: socket.remotePort,
    };

    // ------------------------------------------------------------
    // 7.3 REQUEST DETAILS
    // ------------------------------------------------------------

    const requestDetails: RequestDetails = {

      headers: this.getSafeHeaders(req),

      contentType: this.getHeader(req, 'content-type'),

      contentLength: this.getContentLength(
        this.getHeader(req, 'content-length'),
      ),
    };

    // ------------------------------------------------------------
    // 7.4 REQUEST CORRELATION
    // ------------------------------------------------------------

    if (
      this.options.exposeRequestId &&
      !res.headersSent
    ) {

      res.setHeader(
        'X-Request-ID',
        requestId,
      );
    }

    // ------------------------------------------------------------
    // 7.5 ERROR CAPTURE
    // ------------------------------------------------------------

    const captureError = (error: Error): void => {

      capturedError = error;
    };

    req.once('error', captureError);

    res.once('error', captureError);

    // ------------------------------------------------------------
    // 7.6 RESPONSE FINALIZATION
    // ------------------------------------------------------------

    const finalize = (aborted = false): void => {

      if (finalized) {
        return;
      }

      finalized = true;

      const endTime = process.hrtime.bigint();

      const duration =
        Number(endTime - startTime) / 1_000_000;

      // --------------------------------------------------------
      // RESPONSE DETAILS
      // --------------------------------------------------------

      const response: ResponseDetails = {

        statusCode: res.statusCode,

        statusMessage: res.statusMessage,

        contentType: res.getHeader('content-type')?.toString() ?? null,

        contentLength: this.getContentLength(
          res.getHeader('content-length')?.toString() ?? null,
        ),

        headersSent: res.headersSent,

        finished: res.writableFinished,

        connectionAborted: aborted,
      };

      // --------------------------------------------------------
      // PERFORMANCE METRICS
      // --------------------------------------------------------

      const performance: PerformanceMetrics = {

        duration: Number(duration.toFixed(3)),

        // Not measured by this implementation.
        // Requires separate response-header instrumentation.
        timeToFirstByte: null,
      };

      // --------------------------------------------------------
      // CONNECTION DIAGNOSTICS
      // --------------------------------------------------------

      const connection: ConnectionDiagnostics = {

        remoteAddress: socket.remoteAddress,

        remotePort: socket.remotePort,

        localAddress: socket.localAddress,

        localPort: socket.localPort,

        encrypted,

        keepAlive: (
          req.headers.connection?.toLowerCase() === 'keep-alive' ||
          (req.httpVersionMajor === 1 && req.httpVersionMinor >= 1 &&
            req.headers.connection?.toLowerCase() !== 'close')
        ),

        socketBytesRead: socket.bytesRead,

        socketBytesWritten: socket.bytesWritten,
      };

      // --------------------------------------------------------
      // ERROR DIAGNOSTICS
      // --------------------------------------------------------

      const error: ErrorDiagnostics = {

        occurred: Boolean(capturedError),

        ...(capturedError && {
          name: capturedError.name,
          message: capturedError.message,
          stackTrace: capturedError.stack,
        }),
      };

      // --------------------------------------------------------
      // COMPLETE ACCESS LOG
      // --------------------------------------------------------

      const entry: AccessLogEntry = {

        timestamp,

        level: capturedError
          ? LogLevel.ERROR
          : aborted
            ? LogLevel.WARN
            : LogLevel.INFO,

        message: capturedError
          ? 'HTTP request completed with an error'
          : aborted
            ? 'HTTP connection terminated prematurely'
            : 'HTTP request completed',

        request,
        client,
        requestDetails,
        response,
        performance,
        connection,
        error,
      };

      this.emit(
        entry as unknown as Record<string, unknown>,
        entry.level,
      );
    };

    // ------------------------------------------------------------
    // 7.7 RESPONSE LIFECYCLE EVENTS
    // ------------------------------------------------------------

    /**
     * Response finished successfully.
     */
    res.once('finish', () => {

      finalize(false);
    });

    /**
     * Connection closed before response completion.
     */
    res.once('close', () => {

      if (!res.writableFinished) {

        finalize(true);
      }
    });

  }

  // ========================================================================
  // 8. UTILITY METHODS
  // ========================================================================

  /**
   * Waits for all queued file writes to complete.
   */
  public async flush(): Promise<void> {

    await this.writeQueue;
  }

  /**
   * Returns the configured absolute log file path.
   */
  public getLogFilePath(): string {

    return this.logFile;
  }

  /**
   * Returns a copy of the active configuration.
   */
  public getConfiguration(): Readonly<ResolvedLoggerOptions> {

    return {
      ...this.options,
    };
  }

}

// ============================================================================
// 9. DEFAULT LOGGER INSTANCE
// ============================================================================

export const logger = new Logger({
  level: LogLevel.DEBUG,
  destination: 'both',
  format: LogFormat.PRETTY,

  directory: 'src/logs',
  filename: 'access.log',

  includeQuery: false,
  exposeRequestId: true,
  includeUserAgent: true,
  includeIp: true,

  colors: true,
  createDirectory: true,
});

export default logger;