import { getLogger } from './logger.ts'
import { parse } from "https://deno.land/std/flags/mod.ts";

const defaultLogger = getLogger("script")

export { defaultLogger as log }
export { getLogger }
/**
 * Task context
 */
export interface Context {
    args:{ [key:string]: any }
}

type TaskPromise =  () => Promise<any> | any | void
type TaskFunc =  () => any | void
type TaskFuncCtxt =  (context:Context) => any | void

type Task = TaskPromise | TaskFunc | TaskFuncCtxt

export async function run(namedTasks:{[name:string]:Task}, defaultFunc='help'){
  const log = getLogger('main')
  log.level = 'info'
  //console.log("running main with args:",Deno.args)
  const args = Deno.args
  const taskArgs = parse(args)
  let tasks = taskArgs['_'] as string[]
  if(!tasks || tasks.length==0){
      tasks = [defaultFunc]
  }
  if(taskArgs.log){
      log.level = taskArgs.log
  }

  delete taskArgs['_']
  for(var i =0; i < tasks.length; i++){
      const taskName = tasks[i]
      let task: Task
      try {
          task = namedTasks[`${taskName}`] as Task
          log.trace('found task', task)
      } catch(err){
          log.error("err", err)
          throw `No task '${taskName}' exists`
      }
      if(!task){
          log.error(`could not find task function '${taskName}'`, namedTasks)
          throw `No task '${taskName}' exists`
      }
      try {
          const taskContext:Context = { args:{ ...taskArgs }}
          await task(taskContext)
      }
      catch(err){
          log.error(`Task '${taskName}' threw an error`, err)
          throw `Task '${taskName} threw an error`
      }
  }
}   

export default run;
