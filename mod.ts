import { parse } from 'https://deno.land/std/flags/mod.ts'
import * as path from 'https://deno.land/std/path/mod.ts'
import { getLogger, loggerFactory, Logger } from './logger.ts'

loggerFactory.level = 'info'
loggerFactory.rootName = 'deno.runner'

const scriptLogger = getLogger('script')

export { scriptLogger as log }

function getLoggerWithoutPrefix(name: string): Logger {
    return getLogger(name, /*relative*/ false)
}

export { getLoggerWithoutPrefix as getLogger }
/**
 * Task context
 */
export interface TaskContext {
    args: { [key: string]: any }
    log: Logger
}

type Task = ((context: TaskContext) => any) | (() => any)
type TaskArgs = { [key: string]: any } & { log?: string; deir?: string }
type NamedTasks = { [name: string]: Task }

function parseTaskArgs(): TaskArgs {
    return parse(Deno.args) as TaskArgs
}

/*
 * Allow callers to access the task contect globally
 */
export function getTaskContext(taskName: string = 'default') {
    return {
        args: parseTaskArgs(),
        log: getLoggerWithoutPrefix(`task.${taskName}`),
    } as TaskContext
}

// we parse all the args now so we can setup all the logger etc, even before user call 'run'
function init() {
    const taskArgs = parseTaskArgs()

    // allow passing '--trace' directly through as an option
    ;['error', 'warn', 'info', 'debug', 'trace'].forEach((level) => {
        if (taskArgs[level]) {
            loggerFactory.level = level
        }
    })
    if (taskArgs.log) {
        loggerFactory.level = taskArgs.log
    }
}

init()

const log = getLogger('run')

module util {
    export function rightPad(s: string, size: number, padChar = ' '): string {
        while (s.length < size) {
            s = s + padChar
        }
        return s
    }

    export function extractFunctionDocs(func: Function): string | undefined {
        if (!func) {
            return undefined
        }
        const srcLines = func.toString().split(/\r?\n/)
        const commentDelims = '\'"`'
        for (var i = 0; i < srcLines.length && i < 4; i++) {
            const line = srcLines[i].trim()
            if (line.length == 0) {
                continue
            }
            const startChar = line[0]
            const isBeginComment = commentDelims.indexOf(startChar) != -1
            if (isBeginComment) {
                const startIdx = i
                let endIdx = -1
                for (var j = i; j < srcLines.length; j++) {
                    const line = srcLines[j].trim()
                    if (
                        line.endsWith(`${startChar};`) ||
                        line.endsWith(startChar)
                    ) {
                        //done, found end of comments
                        endIdx = j

                        let docs = srcLines
                            .slice(startIdx, endIdx + 1)
                            .join('\n')
                            .trim()
                        if (docs.endsWith(';')) {
                            docs = docs.substr(0, docs.length - 1)
                        }
                        docs = docs.substr(1, docs.length - 2)
                        return docs
                    }
                }
                return undefined
            }
        }
        return undefined
    }

    export function printTasks(lines: string[], tasks: NamedTasks) {
        Object.keys(tasks)
            .sort()
            .forEach((key) => {
                let docs = util.extractFunctionDocs(tasks[key]) || ''
                let name = key
                if (name.startsWith('task_')) {
                    name = name.substring(5)
                }
                lines.push(`     ${util.rightPad(name, 25)} : ${docs}`)
            })
    }
}
// Create a builtin using the user supplied args so we can build help tasks etc
function newBuiltinsTasks(
    namedTasks: NamedTasks,
    opts: { dir?: string; default?: string; logLevel?: string }
): NamedTasks {
    const builtins: NamedTasks = {
        _cache_clear: async function (ctxt: TaskContext) {
            'Clear the deno script cache in $HOME/.cache/deno'

            const home = Deno.env.get('HOME')
            const cacheDir = `${home}/.cache/deno/`
            ctxt.log.info(`Deleting cache dir: '${cacheDir}'`)
            await Deno.remove(cacheDir, { recursive: true })
        },

        _help: async function (ctxt: TaskContext) {
            'Print this help'

            const lines: string[] = []

            lines.push('Help:')
            lines.push('  User Tasks:')
            util.printTasks(lines, namedTasks)

            lines.push('  Builtin Tasks:')
            util.printTasks(lines, builtins)

            lines.push('  User supplied options:')
            lines.push(`      defaultTask: ${opts.default}`)
            lines.push(`      dir: ${opts.dir}`)
            lines.push(`      logLevel: ${opts.logLevel}`)

            console.log(lines.join('\n'))
        },
    }

    return builtins
}

type RunOpts = {
    dir?: string
    default?: string
    logLevel?: string
    tasks: NamedTasks
    meta: any
}
/**
 * Main entry point for users of this module
 */
export async function run(opts: RunOpts) {
    const defaultTaskName = opts.default || '_help'
    const taskArgs = parseTaskArgs()

    //allow setting of default log level. Commandline args win
    if (!taskArgs.log && opts.logLevel) {
        loggerFactory.level = opts.logLevel
    }

    let tasks = taskArgs['_'] as string[]
    if (!tasks || tasks.length == 0) {
        tasks = [defaultTaskName]
    }
    delete taskArgs['_']

    if (taskArgs['help']) {
        tasks = ['_help']
    }

    const initCwd = Deno.cwd()
    setWorkingDir(opts)
    const builtinTasks = newBuiltinsTasks(opts.tasks, opts)
    try {
        await runTasks(opts.tasks, builtinTasks, tasks, taskArgs)
    } finally {
        Deno.chdir(initCwd)
    }
}

function isWindows() {
    return Deno.build.os === 'windows'
}

function setWorkingDir(opts: RunOpts) {
    if (!opts.meta) {
        throw `No 'meta' (import.meta.url) set on RunArgs. THis needs to be set to calculate the basedir to use for all path related operations`
    }
    const runDir = opts.dir
    if (!runDir) {
        return
    }
    // extract the scritp location from the calling script
    let entryScript = new URL(opts.meta.url).pathname
    if (isWindows()) {
        // remove leading '/' for windows paths
        entryScript = entryScript.substring(1)
    }
    log.trace('entryScript', entryScript)

    const entryScriptDir = path.dirname(entryScript)
    log.trace('entryScriptDir', entryScriptDir)

    const baseDir = path.join(entryScriptDir, runDir)
    log.trace('baseDir', baseDir)

    Deno.chdir(baseDir)
}

/**
 * Run the given tasks
 *
 * @param userTasks user/build-script provided tasks
 * @param builtinsTasks
 * @param tasksToRun
 * @param taskArgs
 */
async function runTasks(
    userTasks: NamedTasks,
    builtinsTasks: NamedTasks,
    tasksToRun: string[],
    taskArgs: {}
) {
    for (var i = 0; i < tasksToRun.length; i++) {
        // allow both underscore and dashes in task names (to stay inline with cli conventions)
        const taskName = tasksToRun[i].replace('-', '_')
        let task: Task
        task = userTasks[taskName]
        if (!task) {
            task = userTasks[`task_${taskName}`]
        }
        if (!task) {
            task = builtinsTasks[taskName]
        }
        if (!task) {
            log.error(
                `could not find task function '${taskName}'. Run '_help' to show available tasks`
            )
            return
        }
        log.debug(`running task: '${taskName}'`)
        try {
            const taskContext: TaskContext = {
                args: { ...taskArgs },
                log: getLoggerWithoutPrefix(`task.${taskName}`),
            }
            await task(taskContext).catch((err: unknown) => {
                throw err
            })
        } catch (err) {
            log.error(`Task '${taskName}' threw an error`, err)
            throw `Task '${taskName} threw an error`
        }
    }
}

/**
 * Run a script or function, optionally setting a relative dir to run it within (temporary
 * change to the cwd)
 */
export async function exec(
    opts:
        | string
        | string[]
        | {
              cmd: (() => any) | string | string[]
              dir?: string
          }
): Promise<void> {
    const log = getLogger('build.exec')
    if (typeof opts === 'string') {
        opts = { cmd: opts }
    } else if (Array.isArray(opts)) {
        opts = { cmd: opts }
    }
    const cwdOrginal = Deno.cwd()
    if (opts.dir) {
        Deno.chdir(opts.dir)
    }
    try {
        const cmd = opts.cmd
        if (Array.isArray(cmd)) {
            log.trace('exec (string[])', cmd)
            for (let i = 0; i < cmd.length; i++) {
                const c = cmd[i]
                await _exec(c).catch((err) => {
                    throw err
                })
            }
        } else if (typeof cmd == 'string') {
            log.trace('exec (string)', cmd)
            await _exec(cmd).catch((err) => {
                throw err
            })
        } else {
            log.trace('exec (function)', cmd)
            await cmd().catch((err: unknown) => {
                throw err
            })
        }
    } catch (err) {
        log.error('error while executing', opts, err)
        throw err
    } finally {
        if (opts.dir) {
            Deno.chdir(cwdOrginal)
        }
    }
}

export type ExecOptions = Omit<Deno.RunOptions, 'stdout' | 'stderr'>

const _exec = async (cmd: string | string[] | ExecOptions) => {
    let opts: Deno.RunOptions
    if (typeof cmd === 'string') {
        opts = {
            cmd: cmd.split(' '),
        }
    } else if (Array.isArray(cmd)) {
        opts = {
            cmd,
        }
    } else {
        opts = cmd
    }

    opts.stdout = 'inherit'
    opts.stderr = 'inherit'

    const process = Deno.run(opts)
    const { success } = await process.status()

    if (!success) {
        process.close()
        throw new Error(`error while running '${cmd}'`)
    }
}

export default run
