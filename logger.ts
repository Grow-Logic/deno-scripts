export enum LogLevel {
    TRACE = 1,
    DEBUG = 2,
    INFO = 3,
    WARN = 4,
    ERROR = 5,
    FATAL = 6,
    OFF = 7,
}

export type Level = LogLevel | string

const nameToLevel: { [name: string]: LogLevel } = {
    trace: LogLevel.TRACE,
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
    fatal: LogLevel.FATAL,
    off: LogLevel.OFF,
}
const levelToName = {
    [LogLevel.TRACE]: 'TRACE',
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.WARN]: ' WARN',
    [LogLevel.INFO]: ' INFO',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.FATAL]: 'FATAL',
    [LogLevel.OFF]: '  OFF',
}
function parseLevel(
    levelName: string,
    defaultLevel: LogLevel = LogLevel.INFO
): LogLevel {
    return nameToLevel[(levelName || '').toLowerCase()] || defaultLevel
}

export interface Logger {
    level: Level
    isOff(): boolean
    isEnabled(): boolean
    isTraceEnabled(): boolean
    isDebugEnabled(): boolean
    isInfoEnabled(): boolean
    isWarnEnabled(): boolean
    isErrorEnabled(): boolean
    isFatalEnabled(): boolean
    isLevelEnabled(level: LogLevel): boolean

    trace(msg: any, ...args: any[]): void
    debug(msg: any, ...args: any[]): void
    info(msg: any, ...args: any[]): void
    warn(msg: any, ...args: any[]): void
    error(msg: any, ...args: any[]): void
    fatal(msg: any, ...args: any[]): void

    log(level: LogLevel, msg: string, ...args: any[]): void
    getLogger(childName: string, relative?:boolean): Logger
}

export interface LogFormatter {
    format(event: LogEvent): string
}

export interface LogAppender {
    append(event: LogEvent): void
}

class SimpleLogFormatter implements LogFormatter {
    format(event: LogEvent): string {
        const logName = levelToName[event.level]
        return `[${logName}] ${event.logName} - ${event.msg}`
    }
}

class ConsoleLogAppender implements LogAppender {
    private formatter: LogFormatter

    constructor(formatter: LogFormatter) {
        this.formatter = formatter
    }

    append(event: LogEvent) {
        const line = this.formatter.format(event)
        if (event.level < LogLevel.ERROR) {
            if (event.args.length > 0) {
                console.log(line, ...event.args)
            } else {
                console.log(line)
            }
        } else {
            console.error(line, ...event.args)
        }
    }
}

export interface LogEvent {
    logName: string
    level: LogLevel
    msg: string
    args: any[]
}

class LoggerImpl implements Logger {
    name: string
    _level: LogLevel | null
    private parent: LoggerImpl | null
    private appender: LogAppender | null

    constructor(
        name: string,
        level: LogLevel | null,
        appender: LogAppender | null,
        parent: LoggerImpl | null
    ) {
        this.name = name
        this._level = level
        this.parent = parent
        this.appender = appender
    }

    set level(level: Level) {
        if (typeof level === 'string') {
            level = parseLevel(level)
        }
        this._level = level
    }

    get level(): Level {
        return this._level
            ? this._level
            : this.parent
            ? this.parent.level
            : LogLevel.OFF
    }
    isTraceEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.TRACE)
    }
    isDebugEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.DEBUG)
    }
    isInfoEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.INFO)
    }
    isWarnEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.WARN)
    }
    isErrorEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.ERROR)
    }
    isFatalEnabled(): boolean {
        return this.isLevelEnabled(LogLevel.FATAL)
    }
    isOff(): boolean {
        return this.isLevelEnabled(LogLevel.OFF)
    }
    isEnabled(): boolean {
        return !this.isOff
    }
    isLevelEnabled(level: LogLevel): boolean {
        return this.level <= level
    }
    trace(msg: any, ...args: any[]) {
        this.log(LogLevel.TRACE, msg, args)
    }
    debug(msg: any, ...args: any[]) {
        this.log(LogLevel.DEBUG, msg, args)
    }
    info(msg: any, ...args: any[]) {
        this.log(LogLevel.INFO, msg, args)
    }
    warn(msg: any, ...args: any[]) {
        this.log(LogLevel.WARN, msg, args)
    }
    error(msg: any, ...args: any[]) {
        this.log(LogLevel.ERROR, msg, args)
    }
    fatal(msg: any, ...args: any[]) {
        this.log(LogLevel.FATAL, msg, args)
    }
    log(level: LogLevel, msg: string, ...args: any[]) {
        if (this.isLevelEnabled(level)) {
            this.logEvent({
                logName: this.name,
                msg: msg,
                args: args,
                level: level,
            })
        }
    }

    private logEvent(logEvent: LogEvent) {
        if (this.appender) {
            this.appender.append(logEvent)
        } else if (this.parent) {
            this.parent.logEvent(logEvent)
        }
    }

    getLogger(childName: string, relative?: boolean): Logger {
        return new LoggerImpl(
            relative == false ? childName : `${this.name}.${childName}`,
            /*level*/ null,
            /*appender*/ null,
            this
        )
    }
}

export class LoggerFactory {
    private DEFAULT_FORMATTER = new SimpleLogFormatter()
    private DEFAULT_APPENDER = new ConsoleLogAppender(this.DEFAULT_FORMATTER)
    private DEFAULT_LEVEL = LogLevel.INFO
    private DEFAULT_NAME = 'app'

    private _level: LogLevel = this.DEFAULT_LEVEL
    private _appender!: LogAppender | null
    private _rootName!: string | null

    private rootLogger = new LoggerImpl(
        this._rootName || this.DEFAULT_NAME,
        this._level || this.DEFAULT_LEVEL,
        this._appender || this.DEFAULT_APPENDER,
        null
    )

    set level(level: Level | undefined) {
        this.rootLogger.level = level || this.DEFAULT_LEVEL
    }

    set rootName(name: string) {
        this.rootLogger.name = name
    }

    getLogger(name: string, relative?: boolean): Logger {
        return this.rootLogger.getLogger(name, relative)
    }
}

const loggerFactory = new LoggerFactory()

export { loggerFactory }

// const logLevel = parseLevel(process.env.VUE_APP_LOG_LEVEL)
// loggerFactory.level = logLevel

export function getLogger(name: string, relative?: boolean): Logger {
    if (name.endsWith('.js')) {
        name = name.slice(0, name.length - 3)
    }
    return loggerFactory.getLogger(name, relative)
}
