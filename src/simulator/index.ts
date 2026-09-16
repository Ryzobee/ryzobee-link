export type SimulatorState = 'idle' | 'loading' | 'running' | 'stopping' | 'error'
export interface SimulatorFrame { width: number; height: number; pixels: Uint8ClampedArray }
export interface SimulatorCallbacks {
  onFrame(frame: SimulatorFrame): void
  onLog(log: { level: 'info' | 'error'; message: string }): void
  onState(state: SimulatorState): void
  onError(message: string): void
}
export interface Simulator {
  run(source: string): Promise<void>
  stop(): Promise<void>
  pointer(input: { x: number; y: number; pressed: boolean }): void
  dispose(): void
}

/** One disposable Worker per run keeps Lua VMs and LVGL leases isolated. */
export function createSimulator(callbacks: SimulatorCallbacks): Simulator {
  let worker: Worker | undefined
  let generation = 0
  let runRequest = 0
  let stopped: (() => void) | undefined
  let stopTimer: ReturnType<typeof setTimeout> | undefined
  let stopPromise: Promise<void> | undefined
  function cleanup() {
    worker?.terminate(); worker = undefined
    if (stopTimer) clearTimeout(stopTimer)
    stopTimer = undefined
    stopped?.(); stopped = undefined; stopPromise = undefined
  }
  return {
    async run(source) {
      const request = ++runRequest
      await this.stop()
      if (request !== runRequest) return
      const current = ++generation
      callbacks.onState('loading')
      worker = new Worker(new URL('./worker.ts', import.meta.url), {type:'module'})
      worker.onmessage = ({data}) => {
        if (current !== generation) return
        if (data.type === 'frame') callbacks.onFrame({width:240,height:240,pixels:new Uint8ClampedArray(data.pixels)})
        else if (data.type === 'log') callbacks.onLog({level:data.level,message:data.message})
        else if (data.type === 'state') callbacks.onState(data.state)
        else if (data.type === 'done') { cleanup(); callbacks.onState('idle') }
        else if (data.type === 'error') { cleanup(); callbacks.onError(data.message); callbacks.onState('error') }
      }
      worker.onerror = event => {
        if (current !== generation) return
        cleanup(); callbacks.onError(event.message || '模拟器加载失败'); callbacks.onState('error')
      }
      worker.postMessage({type:'run',source,baseURL:new URL(import.meta.env.BASE_URL + 'simulator/',location.href).href})
    },
    stop() {
      if (!worker) return Promise.resolve()
      if (stopPromise) return stopPromise
      callbacks.onState('stopping')
      stopPromise = new Promise<void>(resolve => {
        stopped = resolve
        worker?.postMessage({type:'stop'})
        // Cooperative cancellation is primary; a crashed runtime cannot lock
        // the editor forever. Terminating a browser Worker touches no device.
        stopTimer = setTimeout(() => { cleanup(); callbacks.onState('idle') }, 800)
      })
      return stopPromise
    },
    pointer(input) { worker?.postMessage({type:'pointer',...input}) },
    dispose() { ++generation; ++runRequest; cleanup() },
  }
}
