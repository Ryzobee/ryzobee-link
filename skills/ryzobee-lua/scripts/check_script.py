#!/usr/bin/env python3
"""Check authoring conventions with the selected firmware's real C/Lua parsers.

No Lua execution, network, ESP-IDF activation, device access, or input writes.
Requires Python 3.9+ and a native C compiler; build outputs live in a temporary dir.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


class FirmwareParser:
    def __init__(self, root: Path, build: Path):
        component = root / 'components/ryz_script_metadata'
        lua = root / 'managed_components/georgik__lua'
        bridge = Path(__file__).with_name('check_lua.c')
        sources = [bridge, component / 'ryz_script_metadata.c', lua / 'lua/onelua.c']
        config = root / 'host/sdkconfig.h'
        includes = [root / 'host', root / 'tests/script_metadata_stubs',
                    component / 'include', lua / 'include', lua / 'lua']
        for path in [*sources, config, *includes]:
            if not path.exists():
                raise ValueError(f'缺少所选固件依赖：{path}；不会下载依赖或切换工作树')
        binary = build / 'ryz_lua_check.so'
        command = [*shlex.split(os.environ.get('CC', 'cc')), '-std=c11', '-O1',
                   '-shared', '-fPIC', '-DMAKE_LIB', '-include', str(config),
                   *[flag for path in includes for flag in ('-I', str(path))],
                   *map(str, sources), '-lm', '-o', str(binary)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise ValueError('Host 校验库编译失败：\n' + result.stderr[-6000:])
        self.lib = ctypes.CDLL(str(binary))
        self.lib.ryz_skill_metadata_size.argtypes = []
        self.lib.ryz_skill_metadata_size.restype = ctypes.c_size_t
        self.lib.ryz_skill_source_max.argtypes = []
        self.lib.ryz_skill_source_max.restype = ctypes.c_size_t
        self.lib.ryz_script_metadata_parse.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_void_p]
        self.lib.ryz_script_metadata_parse.restype = ctypes.c_int
        self.lib.ryz_skill_metadata_value.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.lib.ryz_skill_metadata_value.restype = ctypes.c_char_p
        self.lib.ryz_skill_metadata_flags.argtypes = [ctypes.c_void_p, ctypes.c_int]
        self.lib.ryz_skill_metadata_flags.restype = ctypes.c_int
        self.lib.ryz_skill_lua_check.argtypes = [ctypes.c_char_p, ctypes.c_size_t,
                                               ctypes.c_void_p, ctypes.c_size_t]
        self.lib.ryz_skill_lua_check.restype = ctypes.c_int
        self.source_max = self.lib.ryz_skill_source_max()

    def check(self, path: Path, legacy=False):
        errors = []
        report = {'path': str(path), 'mode': 'legacy' if legacy else 'ryz-app/1',
                  'metadata': {}, 'syntax': 'not_checked', 'errors': errors}
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,36}\.lua', path.name):
            errors.append('文件名应为 1..36 个 ASCII 字母/数字/下划线/连字符，加 .lua')
        try:
            # Bound the read as well as the native parser input.
            with path.open('rb') as stream:
                source = stream.read(self.source_max + 1)
        except OSError as exc:
            errors.append(str(exc))
            report['ok'] = False
            return report
        report['bytes'] = len(source)
        if not 1 <= len(source) <= self.source_max:
            errors.append(f'完整源文件必须为 1..{self.source_max} 字节')
            report['ok'] = False
            return report
        if b'\0' in source:
            errors.append('源文件不应包含 NUL 字节')
        try:
            source.decode('utf-8', errors='strict')
        except UnicodeDecodeError:
            errors.append('作者规范要求整个源文件为有效 UTF-8')
        if legacy:
            app_marker = re.match(rb'-- ryz-app/1(?:$|[\r\n\t ])', source)
            if app_marker or source.startswith(b'-- ryz-neuro/'):
                errors.append('--legacy 不能用于 app/neuro ABI 脚本')
        elif source.split(b'\n', 1)[0].removesuffix(b'\r') != b'-- ryz-app/1':
            errors.append('新 app 第一行须精确为 -- ryz-app/1，无 BOM/前导空行或空格')
        metadata = ctypes.create_string_buffer(self.lib.ryz_skill_metadata_size())
        status = self.lib.ryz_script_metadata_parse(source, len(source), metadata)
        if status != 0:
            errors.append(f'C 元数据解析器返回 {status}')
        else:
            for index, field in enumerate(('author', 'version', 'description')):
                flags = self.lib.ryz_skill_metadata_flags(metadata, index)
                value = self.lib.ryz_skill_metadata_value(metadata, index).decode('utf-8')
                report['metadata'][field] = {'value': value, 'present': bool(flags & 1),
                                             'truncated': bool(flags & 2), 'invalid': bool(flags & 4)}
                if not flags & 1 or not value:
                    errors.append(f'@{field}: 缺失或为空')
                if flags & 2:
                    errors.append(f'@{field}: 超过固件字节上限，会被截断')
                if flags & 4:
                    errors.append(f'@{field}: 重复或含非法字符')
        message = ctypes.create_string_buffer(2048)
        status = self.lib.ryz_skill_lua_check(source, len(source), message, len(message))
        report['syntax'] = 'pass' if status == 0 else 'fail'
        if status:
            errors.append(message.value.decode('utf-8', errors='replace'))
        report['ok'] = not errors
        return report


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument('--firmware-root', required=True, type=Path,
                           help='选定工作树中的 firmware/rootmaker 目录（不是单纯 ESP-IDF 目录）')
    arguments.add_argument('--legacy', action='store_true', help='检查无 app marker 的旧运行入口')
    arguments.add_argument('scripts', nargs='+', type=Path)
    args = arguments.parse_args()
    try:
        root = args.firmware_root.expanduser().resolve(strict=True)
        with tempfile.TemporaryDirectory(prefix='ryz-lua-check-') as temporary:
            parser = FirmwareParser(root, Path(temporary))
            results = [parser.check(path.expanduser().absolute(), args.legacy) for path in args.scripts]
        print(json.dumps({'firmware_root': str(root), 'lua_executed': False,
                          'results': results}, ensure_ascii=False, indent=2))
        return 0 if all(result['ok'] for result in results) else 1
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        print(f'校验环境不可用：{exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
