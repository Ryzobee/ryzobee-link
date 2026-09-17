/// <reference lib="webworker" />
export {}
type Runtime = {
  HEAPU8: Uint8Array
  _malloc(bytes: number): number
  _free(pointer: number): void
  _link_stop(): void
  _link_pointer(x: number, y: number, pressed: number): void
  ccall(name: string, result: string, types: string[], args: number[], options: {async: true}): Promise<number>
}
const scope = self as unknown as DedicatedWorkerGlobalScope
let runtime: Runtime | undefined
let stopping = false
const send = (message: unknown) => scope.postMessage(message)
let pendingFrame: Uint8ClampedArray | undefined
let logText = ''
let droppedLogBytes = 0
let flushTimer: ReturnType<typeof setTimeout> | undefined
function flush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = undefined
  if (pendingFrame) {
    scope.postMessage({type:'frame',pixels:pendingFrame.buffer},[pendingFrame.buffer])
    pendingFrame = undefined
  }
  if (logText) { send({type:'log',level:'info',message:logText}); logText = '' }
  if (droppedLogBytes) { send({type:'log',level:'error',message:`输出过快，已省略 ${droppedLogBytes} 字符`}); droppedLogBytes = 0 }
}
function scheduleFlush() { flushTimer ??= setTimeout(flush, 16) }
function collectLog(message: string) {
  const remaining = Math.max(0, 8192 - logText.length)
  logText += message.slice(0,remaining)
  droppedLogBytes += Math.max(0,message.length - remaining)
  scheduleFlush()
}
scope.onmessage = ({data}) => {
  if (data.type === 'stop') { stopping = true; runtime?._link_stop(); return }
  if (data.type === 'pointer') { runtime?._link_pointer(data.x,data.y,Number(data.pressed)); return }
  if (data.type !== 'run') return
  void execute(data.source, data.baseURL).catch(error => send({type:'error',phase:'init',message:error instanceof Error ? error.message : String(error)}))
}
async function execute(source: string, baseURL: string) {
  const bytes = new TextEncoder().encode(source)
  if (bytes.length === 0 || bytes.length > 16384) throw new Error('Lua 脚本需为 1–16384 字节')
  const {default:createRuntime} = await import(/* @vite-ignore */ new URL('ryzobee.js',baseURL).href)
  runtime = await createRuntime({
    locateFile: (name: string) => new URL(name,baseURL).href,
    onFrame: (pixels: Uint8ClampedArray) => { pendingFrame = pixels; scheduleFlush() },
    onLog: collectLog,
    print: collectLog,
    printErr: (message: string) => send({type:'log',level:'error',message}),
    onResult: (result: {ok: boolean; phase: string; error: string}) => {
      flush()
      if (!result.ok && result.phase !== 'stopped') send({type:'error',phase:result.phase,message:result.error || result.phase})
    },
  })
  if (stopping) { send({type:'done'}); return }
  send({type:'state',state:'running'})
  const pointer = runtime!._malloc(bytes.length + 1)
  if (!pointer) throw new Error('模拟器内存不足')
  runtime!.HEAPU8.set(bytes,pointer); runtime!.HEAPU8[pointer+bytes.length]=0
  try { await runtime!.ccall('link_run','number',['number','number'],[pointer,bytes.length],{async:true}) }
  finally { runtime!._free(pointer) }
  flush()
  send({type:'done'})
}
