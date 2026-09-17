export type SimulatorFault = {
  code: string;
  summary: string;
  message: string;
  sourceFile: string;
  line: number;
  limitation: boolean;
};

// Phase codes follow firmware ryz_workbench/workbench_fault.c. A rejected
// module is a simulator capability boundary, not evidence of a device failure.
export function describeFault(message: string, phase = 'runtime', sourceFile = 'main.lua'): SimulatorFault {
  const limitation = /module not allowed:\s*\S+|module\s+['"][^'"]+['"]\s+not found|not (?:supported|available) in (?:the )?simulator/i.test(message);
  const phases: Record<string, [string, string]> = {
    runtime: ['LUA-R01', 'Runtime error'], syntax: ['LUA-S01', 'Syntax error'],
    timeout: ['LUA-T01', 'Execution timed out'], memory: ['LUA ERROR', 'Lua memory limit reached'],
    prepare: ['LUA ERROR', 'Script preparation failed'], init: ['LUA ERROR', 'Script initialization failed'],
  };
  const [code, summary] = limitation ? ['UI ONLY', '模拟器仅能模拟纯UI的界面'] : phases[phase] ?? ['LUA ERROR', 'Script execution failed'];
  return { code, summary, message, sourceFile, line: Number(message.match(/:(\d+):/)?.[1] ?? 0), limitation };
}
