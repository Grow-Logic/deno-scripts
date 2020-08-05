import { parse } from "https://deno.land/std/flags/mod.ts";
import { exec as real_exec, execSequence,OutputMode} from "https://deno.land/x/exec/mod.ts";
import * as path from "https://deno.land/std/path/mod.ts"
import { getLogger, loggerFactory, Logger } from "./logger.ts";

loggerFactory.level = "info";
loggerFactory.rootName = "deno.runner";

const scriptLogger = getLogger("script");

export { scriptLogger as log };

function getLoggerWithoutPrefix(name:string) : Logger {
  return getLogger(name, /*relative*/ false)
}

export {  getLoggerWithoutPrefix as getLogger };
/**
 * Task context
 */
export interface TaskContext {
  args: { [key: string]: any };
  log: Logger  
}

type Task = ((context: TaskContext) => any) | (() => any);
type NamedTasks = { [name: string]: Task }

const log = getLogger("run");

module BuiltinTasks {
  export async function clear_cache(){
    log.info("Clear cache")
    // ~/.cache/deno/*
    const home = Deno.env.get("HOME")    
    await Deno.remove(`${home}/.cache/deno/`, { recursive: true })
  }
}

const builtins:NamedTasks = { _clear_cache: BuiltinTasks.clear_cache }

export async function run(
  namedTasks: NamedTasks,
  opts: { dir?: string; default?: string, logLevel?:string },
) {
  const defaultTaskName = opts.default || "help";
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

  const initCwd = Deno.cwd()
  setWorkingDir(runDir)
  try {
      await runTasks(namedTasks, tasks, taskArgs)
  } finally {
    Deno.chdir(initCwd)
  }
}

function setWorkingDir(runDir:string){

  // this env var must be set by the wrapping script (usually deno-sh)
  const entryScript = Deno.env.get("DENO_ENTRY_SCRIPT")
  log.trace("entryScript", entryScript)
  if(!entryScript){
    throw `Not env var 'DENO_ENTRY_SCRIPT' env set. THis needs to be set to calculate the basedir to use for all path related operations`
  }

  const entryScriptDir = path.dirname(entryScript)
  log.trace("entryScriptDir",entryScriptDir)

  const baseDir = path.join(entryScriptDir, runDir)
  log.trace("baseDir",baseDir)

  Deno.chdir(baseDir)
}

async function runTasks(namedTasks: NamedTasks, tasksToRun:string[], taskArgs:{}){
    for (var i = 0; i < tasksToRun.length; i++) {
      const taskName = tasksToRun[i];
      let task: Task;
      try {
        task = namedTasks[taskName];
        if(!task){
            task = builtins[taskName];
        }
        log.trace("found task", task);
      } catch (err) {
        log.error("error getting task to run", err);
        throw `No task '${taskName}' exists`;
      }
      if (!task) {
        log.error(`could not find task function '${taskName}'`, { userTasks: namedTasks, builtinTasks: builtins });
        throw `No task function with name '${taskName}' exists`;
      }
      log.debug(`running task: '${taskName}'`)
      try {
        const taskContext: TaskContext = { args: { ...taskArgs }, log: getLoggerWithoutPrefix(`task.${taskName}`) };
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
export async function exec(opts:{ cmd:(()=>any) | string | string[], dir?:string }) {
  const log = getLogger('build.exec')

  const cwd = Deno.cwd()
  if(opts.dir){
    Deno.chdir(opts.dir)
  }
  try {
    const cmd = opts.cmd
    if(Array.isArray(cmd)){
      log.trace('exec (string[])', cmd)
      
      await execSequence(cmd, { output: OutputMode.StdOut, continueOnError: false });
    } else if(typeof cmd == 'string'){
      log.trace('exec (string)', cmd)
      
      await real_exec(cmd, { output: OutputMode.StdOut })
    } else {
      log.trace('exec (function)', cmd)

      await cmd()
    }
  } finally {  
    if(opts.dir){
      Deno.chdir(cwd)
    }
  }
}

export default run;
