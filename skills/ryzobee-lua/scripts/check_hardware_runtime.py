#!/usr/bin/env python3
"""Compile real firmware Lua facades, execute a script, emit one JSON result.

No firmware/device writes. Build outputs default to a temporary directory.
The program is a development fixture, not an OS sandbox for hostile VM exploits.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent


def fingerprint(root):
    sources = [HERE / 'contract_runner.c', root / 'tests/lua_peripherals_test.c',
               root / 'host/sdkconfig.h']
    for directory in ['components/ryz_runtime', 'components/ryz_tools/include',
                      'components/ryz_lvgl/include', 'components/ryz_i2c_scan/include',
                      'components/ryz_rgb/include', 'components/ryz_monitor/include',
                      'managed_components/georgik__lua']:
        sources.extend(sorted((root / directory).rglob('*.h')))
    sources.extend(sorted((root / 'managed_components/georgik__lua/lua').glob('*.c')))
    sources.extend(root / 'components/ryz_runtime' / name for name in ['app_runtime.c', 'app_tools.c'])
    digest = hashlib.sha256()
    for path in sources:
        digest.update(str(path).encode()); digest.update(path.read_bytes())
    return digest.hexdigest()


def build(root, directory, sanitize=True):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    binary = directory / ('contract-runner-asan' if sanitize else 'contract-runner')
    stamp = binary.with_suffix('.json')
    compiler = os.environ.get('CC', 'cc')
    identity = {'source_sha256': fingerprint(root), 'sanitize': sanitize, 'compiler': compiler}
    if binary.exists() and stamp.exists() and json.loads(stamp.read_text()) == identity:
        return binary, identity
    include = [root, root / 'host']
    include.extend(root / 'components' / name / 'include' for name in
                   ['ryz_runtime', 'ryz_board', 'ryz_lvgl', 'ryz_tools', 'ryz_i2c_scan', 'ryz_rgb', 'ryz_monitor'])
    lua = root / 'managed_components/georgik__lua'
    include.extend([lua / 'include', lua / 'lua'])
    command = [compiler, '-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DMAKE_LIB',
               '-include', str(root / 'host/sdkconfig.h')]
    if sanitize:
        command.append('-fsanitize=address,undefined')
    for path in include:
        command.extend(['-I', str(path)])
    command.extend([str(HERE / 'contract_runner.c'), str(root / 'components/ryz_runtime/app_runtime.c'),
                    str(root / 'components/ryz_runtime/app_tools.c'), str(lua / 'lua/onelua.c'),
                    '-lm', '-o', str(binary)])
    process = subprocess.run(command, capture_output=True, text=True, timeout=60)
    if process.returncode:
        raise RuntimeError(process.stdout + process.stderr)
    stamp.write_text(json.dumps(identity, indent=2) + '\n')
    return binary, identity


def execute(binary, source, mode='success', virtual_ms=1000, wall_seconds=5):
    try:
        result = subprocess.run([str(binary), str(source), mode, str(virtual_ms)],
                                capture_output=True, text=True, timeout=wall_seconds,
                                env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})
    except subprocess.TimeoutExpired:
        return {'ok': False, 'phase': 'process_timeout', 'error': 'host process deadline exceeded',
                'mode': mode, 'wall_limit_seconds': wall_seconds, 'adapter': None}
    try:
        document = json.loads(result.stdout)
    except json.JSONDecodeError:
        document = {'ok': False, 'phase': 'harness_process',
                    'error': 'runner did not emit valid JSON', 'stdout': result.stdout[-8192:]}
    document['process_returncode'] = result.returncode
    if result.returncode != 0:
        document['ok'] = False
    if result.stderr:
        document['stderr'] = result.stderr[-8192:]
    return document


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path)
    parser.add_argument('--firmware-root', '--root', dest='firmware_root', type=Path, required=True)
    parser.add_argument('--mode', choices=['success', 'unavailable'], default='success')
    parser.add_argument('--virtual-ms', type=int, default=1000)
    parser.add_argument('--wall-seconds', type=float, default=5)
    parser.add_argument('--no-sanitize', action='store_true')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--build-dir', type=Path)
    args = parser.parse_args()
    if not 1 <= args.virtual_ms <= 600000 or args.wall_seconds <= 0:
        parser.error('require 1..600000 virtual ms and positive wall seconds')
    if not args.source and not args.build_only:
        parser.error('SOURCE is required unless --build-only')
    if args.build_only and not args.build_dir:
        parser.error('--build-only requires --build-dir to preserve the binary')
    with tempfile.TemporaryDirectory(prefix='ryz-lua-contract-') as temporary:
        try:
            binary, identity = build(args.firmware_root.resolve(), args.build_dir or temporary, not args.no_sanitize)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
            print(json.dumps({'ok': False, 'phase': 'build', 'error': str(error)}))
            return 2
        if args.build_only:
            document = {'ok': True, 'phase': 'built', 'binary': str(binary)}
        else:
            document = execute(binary, args.source.resolve(), args.mode, args.virtual_ms, args.wall_seconds)
            document['source'] = str(args.source.resolve())
        document['build'] = identity
        print(json.dumps(document, ensure_ascii=False))
        return 0 if document['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
