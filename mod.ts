import { parse } from "https://deno.land/std/flags/mod.ts";
import { exec as real_exec, execSequence, OutputMode } from "https://deno.land/x/exec/mod.ts";
import * as path from "https://deno.land/std/path/mod.ts";
import { getLogger, loggerFactory, Logger } from "./logger.ts";

loggerFactory.level = "info";
loggerFactory.rootName = "deno.runner";

const scriptLogger = getLogger("script");

export { scriptLogger as log };

function getLoggerWithoutPrefix(name: string): Logger {
    return getLogger(name, /*relative*/ false);
}

export { getLoggerWithoutPrefix as getLogger };
/**
 * Task context
 */
export interface TaskContext {
    args: { [key: string]: any };
    log: Logger;
}

type Task = ((context: TaskContext) => any) | (() => any);
type NamedTasks = { [name: string]: Task };

const log = getLogger("run");

module utils {
    export function rightPad(s: string, size: number, padChar = " "): string {
        while (s.length < size) {
            s = s + padChar;
        }
        return s;
    }
    export function extractFunctionDocs(func: Function): string | undefined {
        if (!func) {
            return undefined;
        }
        const srcLines = func.toString().split(/\r?\n/);
        const commentDelims = "'\"`";
        for (var i = 0; i < srcLines.length && i < 4; i++) {
            const line = srcLines[i].trim();
            if (line.length == 0) {
                continue;
            }
            const startChar = line[0];
            const isBeginComment = commentDelims.indexOf(startChar) != -1;
            if (isBeginComment) {
                const startIdx = i;
                let endIdx = -1;
                for (var j = i; j < srcLines.length; j++) {
                    const line = srcLines[j].trim();
                    if (line.endsWith(`${startChar};`) || line.endsWith(startChar)) {
                        //done, found end of comments
                        endIdx = j;

                        let docs = srcLines
                            .slice(startIdx, endIdx + 1)
                            .join("\n")
                            .trim();
                        if (docs.endsWith(";")) {
                            docs = docs.substr(0, docs.length - 1);
                        }
                        docs = docs.substr(1, docs.length - 2);
                        return docs;
                    }
                }
                return undefined;
            }
        }

        return undefined;
    }
}
// Create a builtin using the user supplied args so we can build help tasks etc
function newBuiltinsTasks(
    namedTasks: NamedTasks,
    opts: { dir?: string; default?: string; logLevel?: string }
): NamedTasks {
    const builtins: NamedTasks = {
        _clear_cache: async function (ctxt: TaskContext) {
            "Clear the deno script cache in $HOME/.cache/deno";

            const home = Deno.env.get("HOME");
            const cacheDir = `${home}/.cache/deno/`;
            ctxt.log.info(`Deleting cache dir: '${cacheDir}'`);
            await Deno.remove(cacheDir, { recursive: true });
        },

        _help: async function (ctxt: TaskContext) {
            "Print this help";

            const lines: string[] = [];

            lines.push("Help:");
            lines.push("  User Tasks:");
            Object.keys(namedTasks).forEach((key) => {
                let docs = utils.extractFunctionDocs(namedTasks[key]) || "";
                let name = key;
                if (name.startsWith("task_")) {
                    name = name.substring(5);
                }
                lines.push(`     ${utils.rightPad(name, 25)} : ${docs}`);
            });

            lines.push("  Builtin Tasks:");
            Object.keys(builtins).forEach((key) => {
                let docs = utils.extractFunctionDocs(builtins[key]) || "";
                lines.push(`     ${utils.rightPad(key, 25)} : ${docs}`);
            });

            lines.push("  User supplied options:");
            lines.push(`      defaultTask: ${opts.default}`);
            lines.push(`      dir: ${opts.dir}`);
            lines.push(`      logLevel: ${opts.logLevel}`);

            console.log(lines.join("\n"));
        },
    };

    return builtins;
}

export async function run(userTasks: NamedTasks, opts: { dir?: string; default?: string; logLevel?: string }) {
    const defaultTaskName = opts.default || "_help";
    const runDir = opts.dir || ".";

    const taskArgs = parse(Deno.args);

    if (taskArgs.log) {
        loggerFactory.level = taskArgs.log;
    }
    if (opts.logLevel) {
        loggerFactory.level = opts.logLevel;
    }

    let tasks = taskArgs["_"] as string[];
    if (!tasks || tasks.length == 0) {
        tasks = [defaultTaskName];
    }
    delete taskArgs["_"];

    const initCwd = Deno.cwd();
    setWorkingDir(runDir);
    const builtinTasks = newBuiltinsTasks(userTasks, opts);
    try {
        await runTasks(userTasks, builtinTasks, tasks, taskArgs);
    } finally {
        Deno.chdir(initCwd);
    }
}

function setWorkingDir(runDir: string) {
    // this env var must be set by the wrapping script (usually deno-sh)
    const entryScript = Deno.env.get("DENO_ENTRY_SCRIPT");
    log.trace("entryScript", entryScript);
    if (!entryScript) {
        throw `Not env var 'DENO_ENTRY_SCRIPT' env set. THis needs to be set to calculate the basedir to use for all path related operations`;
    }

    const entryScriptDir = path.dirname(entryScript);
    log.trace("entryScriptDir", entryScriptDir);

    const baseDir = path.join(entryScriptDir, runDir);
    log.trace("baseDir", baseDir);

    Deno.chdir(baseDir);
}

/**
 * Run the given tasks
 *
 * @param userTasks user/build-script provided tasks
 * @param builtinsTasks
 * @param tasksToRun
 * @param taskArgs
 */
async function runTasks(userTasks: NamedTasks, builtinsTasks: NamedTasks, tasksToRun: string[], taskArgs: {}) {
    for (var i = 0; i < tasksToRun.length; i++) {
        const taskName = tasksToRun[i];
        let task: Task;
        task = userTasks[taskName];
        if (!task) {
            task = builtinsTasks[taskName];
            if (!task) {
                task = builtinsTasks[`task_${taskName}`];
            }
        }
        log.trace("found task", task);
        if (!task) {
            log.error(`could not find task function '${taskName}'. Run '_help' to show available tasks`);
            return;
        }
        log.debug(`running task: '${taskName}'`);
        try {
            const taskContext: TaskContext = {
                args: { ...taskArgs },
                log: getLoggerWithoutPrefix(`task.${taskName}`),
            };
            await task(taskContext);
        } catch (err) {
            log.error(`Task '${taskName}' threw an error`, err);
            throw `Task '${taskName} threw an error`;
        }
    }
}

/**
 * Run a script or function, optionally setting a relative dir to run it within (temporary
 * change to the cwd)
 */
export async function exec(opts: { cmd: (() => any) | string | string[]; dir?: string }) {
    const log = getLogger("build.exec");

    const cwd = Deno.cwd();
    if (opts.dir) {
        Deno.chdir(opts.dir);
    }
    try {
        const cmd = opts.cmd;
        if (Array.isArray(cmd)) {
            log.trace("exec (string[])", cmd);

            await execSequence(cmd, { output: OutputMode.StdOut, continueOnError: false });
        } else if (typeof cmd == "string") {
            log.trace("exec (string)", cmd);

            await real_exec(cmd, { output: OutputMode.StdOut });
        } else {
            log.trace("exec (function)", cmd);

            await cmd();
        }
    } finally {
        if (opts.dir) {
            Deno.chdir(cwd);
        }
    }
}

export default run;