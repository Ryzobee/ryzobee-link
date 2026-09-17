#!/usr/bin/env python3
"""Execute an app in the firmware's bounded UI Host, never on a device.

Checks executed native calls/schema, not unvisited branches or physical hardware.
Requires the selected firmware's Host sources, frozen Lua, Python 3.9+, and cc.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import shlex
import subprocess
import sys
import tempfile

from check_script import FirmwareParser

OUTPUT_LIMIT = 2 * 1024 * 1024


def output_limit():
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))


class UiRuntime:
    def __init__(self, root, build):
        self.binary = build / 'app-host'
        lua = root / 'managed_components/georgik__lua'
        includes = [root / 'host', lua / 'include', lua / 'lua']
        includes += [root / 'components' / name / 'include' for name in (
            'ryz_runtime', 'ryz_lvgl', 'ryz_tools', 'ryz_i2c_scan', 'ryz_rgb', 'ryz_monitor')]
        sources = [root / 'host/app_host.c', root / 'components/ryz_runtime/app_runtime.c',
                   root / 'components/ryz_runtime/app_tools.c', lua / 'lua/onelua.c']
        command = [*shlex.split(os.environ.get('CC', 'cc')), '-std=c11', '-O1',
                   '-Wall', '-Wextra', '-Werror', '-DMAKE_LIB', '-include',
                   str(root / 'host/sdkconfig.h'),
                   *[flag for path in includes for flag in ('-I', str(path))],
                   *map(str, sources), '-lm', '-o', str(self.binary)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise ValueError('UI Host 编译失败：\n' + result.stderr[-6000:])

    def run(self, path, replay='end 1000\n', timeout=8):
        result = {'path': str(path), 'ok': False, 'mode': 'ui-host',
                  'coverage': 'executed-paths-only', 'hardware_verified': False}
        if len(replay.encode('utf-8')) > 32768:
            return {**result, 'error': '回放输入超过 32 KiB'}
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            try:
                process = subprocess.run([str(self.binary), str(path)], input=replay.encode(),
                    stdout=output, stderr=errors, timeout=timeout, preexec_fn=output_limit)
            except subprocess.TimeoutExpired:
                return {**result, 'error': 'UI Host 进程超时；未完成验证'}
            output.seek(0)
            raw = output.read(OUTPUT_LIMIT + 1)
            errors.seek(0)
            error_text = errors.read(4096).decode('utf-8', errors='replace')
        if len(raw) >= OUTPUT_LIMIT:
            return {**result, 'error': 'UI Host 输出超过 2 MiB；未完成验证'}
        try:
            records = [json.loads(line) for line in raw.splitlines() if line.strip()]
        except (ValueError, UnicodeDecodeError):
            return {**result, 'error': 'UI Host 输出损坏；未完成验证', 'stderr': error_text}
        summaries = [record for record in records if record.get('summary')]
        if len(summaries) != 1:
            return {**result, 'error': 'UI Host 缺少唯一结果', 'returncode': process.returncode,
                    'stderr': error_text}
        summary = summaries[0]
        result.update(ok=process.returncode == 0 and summary.get('ok') is True,
                      phase=summary.get('phase'), error=summary.get('error'),
                      trace=[record for record in records if record.get('event') == 'frame'],
                      stderr=error_text)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firmware-root', type=Path, required=True)
    parser.add_argument('--replay', type=Path, help='app-host pointer/check/end 文本回放')
    parser.add_argument('--duration-ms', type=int, default=1000, help='无回放时的虚拟运行时长，1..600000')
    parser.add_argument('scripts', nargs='+', type=Path)
    args = parser.parse_args()
    if not 1 <= args.duration_ms <= 600000:
        parser.error('--duration-ms must be 1..600000')
    try:
        root = args.firmware_root.expanduser().resolve(strict=True)
        if args.replay:
            with args.replay.expanduser().open('r', encoding='utf-8') as stream:
                replay = stream.read(32769)
        else:
            replay = f'end {args.duration_ms}\n'
        with tempfile.TemporaryDirectory(prefix='ryz-ui-check-') as temporary:
            build = Path(temporary)
            metadata = FirmwareParser(root, build)
            runtime = UiRuntime(root, build)
            results = []
            for path in args.scripts:
                path = path.expanduser().absolute()
                initial = metadata.check(path)
                if initial['ok']:
                    results.append(runtime.run(path, replay))
                else:
                    results.append({'path': str(path), 'ok': False, 'preflight': initial})
        print(json.dumps({'firmware_root': str(root), 'lua_executed': True,
                          'device_access': False, 'results': results}, ensure_ascii=False, indent=2))
        return 0 if all(result['ok'] for result in results) else 1
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f'UI 验证环境不可用：{exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
