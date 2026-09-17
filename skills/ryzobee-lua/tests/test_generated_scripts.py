#!/usr/bin/env python3
"""Replay frozen generated scripts against the selected real Lua facades.

Five final scripts must satisfy observable behavior. Two historical scripts
must still pass metadata/syntax/interfaces but fail the SAME semantic rules.
No model call, external evaluator, credential lookup, or device access occurs.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
SKILL = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / 'fixtures'
sys.path.insert(0, str(SKILL / 'scripts'))
from check_script import FirmwareParser
from check_ui_runtime import UiRuntime
from check_hardware_runtime import build as build_hardware, execute as execute_hardware


class Rules:
    def __init__(self):
        self.items = []

    def check(self, name, condition, expected, observed):
        self.items.append({'rule': name, 'ok': bool(condition),
                           'expected': expected, 'observed': observed})

    @property
    def failed(self):
        return [item['rule'] for item in self.items if not item['ok']]


def screen_texts(frame):
    return [value for name, value in frame.get('nodes', {}).items()
            if name.startswith('screen.text.') and isinstance(value, str)]


def ui_rules(name, outcome, without_drag=None):
    rules = Rules()
    frames = outcome.get('trace', [])
    initial = [f for f in frames if f.get('at', -1) < 100 and screen_texts(f)]
    rules.check('ui.full_screen', bool(frames) and all(f.get('width') == 240 and f.get('height') == 240 for f in frames),
                'all frames 240x240', [{'width': f.get('width'), 'height': f.get('height')} for f in frames])
    if name == 'ds_counter':
        final = [f for f in frames if f.get('at', -1) >= 180]
        rules.check('counter.initial_zero', any('COUNT 0' in screen_texts(f) and 'ADD' in screen_texts(f) for f in initial),
                    'COUNT 0 and ADD before first pointer down', [screen_texts(f) for f in initial])
        rules.check('counter.click_increments', bool(final) and 'COUNT 1' in screen_texts(final[-1]),
                    'COUNT 1 after the recorded ADD click', [screen_texts(f) for f in final])
    else:
        after_drag = [f for f in frames if 320 <= f.get('at', -1) < 420]
        final = [f for f in frames if f.get('at', -1) >= 520]
        rules.check('scroll.initial_none', any('SELECTED NONE' in screen_texts(f) and 'ALPHA' in screen_texts(f) for f in initial),
                    'SELECTED NONE and ALPHA before drag', [screen_texts(f) for f in initial])
        rules.check('scroll.drag_does_not_activate', bool(after_drag) and all('SELECTED NONE' in screen_texts(f) for f in after_drag),
                    'drag changes offset without activating a row', [screen_texts(f) for f in after_drag])
        # app-host records every object text; it does not project viewport
        # clipping into that text list. Prove scrolling through the real core's
        # hit testing: the SAME final pointer coordinates select a different row.
        baseline_frames = (without_drag or {}).get('trace', [])
        baseline_texts = screen_texts(baseline_frames[-1]) if baseline_frames else []
        rules.check('scroll.same_click_without_drag', 'SELECTED ECHO' in baseline_texts,
                    'same final click selects ECHO when earlier drag events are omitted', baseline_texts)
        rules.check('scroll.click_selects_last', bool(final) and 'SELECTED FOXTROT' in screen_texts(final[-1]),
                    'SELECTED FOXTROT after the recorded last-row click', [screen_texts(f) for f in final])
    running = frames[-1].get('nodes', {}).get('app.running') if frames else None
    rules.check('ui.host_terminated', running is False,
                'last Host frame reports app.running=false', running)
    return rules


def hardware_rules(name, modes):
    rules = Rules()
    for mode, outcome in modes.items():
        adapter = outcome.get('adapter') or {}
        rules.check(f'{mode}.cleanup', adapter.get('cleanup_calls') == 1 and adapter.get('handles_remaining') == 0,
                    'one platform cleanup and no virtual peripheral handles remain',
                    {key: adapter.get(key) for key in ('cleanup_calls', 'handles_opened', 'handles_closed', 'handles_remaining')})
        rules.check(f'{mode}.deadline', isinstance(outcome.get('elapsed_virtual_ms'), int)
                    and outcome['elapsed_virtual_ms'] < 5000,
                    'script finishes before 5000 virtual ms', outcome.get('elapsed_virtual_ms'))
        if mode == 'unavailable':
            rules.check('unavailable.no_handles', adapter.get('handles_opened') == 0 and adapter.get('handles_closed') == 0,
                        'no unavailable device becomes a handle',
                        [adapter.get('handles_opened'), adapter.get('handles_closed')])
    good = modes['success'].get('adapter') or {}
    absent = modes['unavailable'].get('adapter') or {}
    success_output = modes['success'].get('output', '')
    unavailable_output = modes['unavailable'].get('output', '')
    if name == 'ds_i2c':
        observed = good.get('peripherals', {}).get('i2c', {})
        rules.check('i2c.full_address_sweep', observed.get('probe') == 112 and observed.get('open') == observed.get('close') == 1,
                    '112 probes and exactly one acquired/closed bus', observed)
        rules.check('i2c.fixture_timeout_reported', '0x52' in success_output and 'timeout' in success_output and 'incomplete' in success_output,
                    'retained fixture fault at 0x52 is reported as incomplete', success_output)
        missing = absent.get('peripherals', {}).get('i2c', {})
        rules.check('i2c.unavailable', missing.get('open') == 1 and missing.get('probe') == 0 and 'unavailable' in unavailable_output,
                    'unavailable open is reported and no probes occur', {'calls': missing, 'output': unavailable_output})
    elif name == 'ds_imu':
        h = good.get('hardware', {})
        expected = {'wifi.is_connected': 1, 'ble.is_connected': 1, 'hid.is_ready': 1,
                    'imu.init': 1, 'imu.read': 10, 'imu.deinit': 1}
        rules.check('imu.ten_samples_lifecycle', all(h.get(key) == value for key, value in expected.items()), expected, h)
        sample_numbers = [int(n) for n in re.findall(r'^IMU (\d+)/10 seq=', success_output, re.MULTILINE)]
        rules.check('imu.ten_samples_reported', sample_numbers == list(range(1, 11)), list(range(1, 11)), sample_numbers)
        absent_h = absent.get('hardware', {})
        absent_expected = {**expected, 'imu.read': 0, 'imu.deinit': 0}
        rules.check('imu.unavailable_lifecycle', all(absent_h.get(key) == value for key, value in absent_expected.items()),
                    absent_expected, absent_h)
        for label in ('WiFi', 'BLE', 'HID'):
            matching = [line for line in unavailable_output.splitlines() if line.startswith(label)]
            rules.check(f'imu.{label.lower()}_unavailable_reason', any('unavailable' in line for line in matching),
                        f'{label} output retains its unavailable reason', matching)
    else:
        uart = good.get('peripherals', {}).get('uart', {})
        led = good.get('peripherals', {}).get('led', {})
        rules.check('uart.exact_ping_bytes', good.get('uart_tx_hex') == '70696e67' and good.get('uart_tx_overflow') is False,
                    'actual accepted TX bytes are exactly lowercase ping (70696e67)',
                    {'uart_tx_hex': good.get('uart_tx_hex'), 'uart_tx_overflow': good.get('uart_tx_overflow')})
        rules.check('uart.short_write_retried', uart.get('write') == 2,
                    'fixture accepts ping as three bytes plus one byte in two writes', uart.get('write'))
        rules.check('uart.methods_and_cleanup', uart.get('open') == uart.get('close') == 1 and uart.get('read', 0) > 0,
                    'UART open/read/close are actually reached', uart)
        rules.check('uart.led_methods_and_cleanup', led.get('open') == led.get('close') == 1
                    and led.get('write', 0) > 0 and led.get('status', 0) > 0,
                    'LED open/write/status/close are actually reached', led)
        rules.check('uart.loss_evidence_retained', 'loss_possible=true' in success_output and 'error_events=3' in success_output,
                    'fixture loss flag and error counter remain visible', success_output)
        missing = absent.get('peripherals', {})
        rules.check('uart.unavailable', missing.get('uart', {}).get('open') == 1 and missing.get('led', {}).get('open') == 1
                    and missing.get('uart', {}).get('write') == 0 and missing.get('led', {}).get('write') == 0
                    and absent.get('uart_tx_hex') == '' and 'unavailable' in unavailable_output,
                    'both unavailable opens are attempted; no UART/LED write occurs',
                    {'uart': missing.get('uart'), 'led': missing.get('led'), 'output': unavailable_output})
    return rules


def interface_pass(outcome, hardware):
    return outcome.get('ok') is True and outcome.get('phase') == 'done' and (
        not hardware or outcome.get('process_returncode') == 0)


def run_suite(root, output):
    builds = {name: output / name for name in ('metadata-build', 'ui-build', 'hardware-build')}
    for directory in builds.values():
        directory.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        metadata_future = pool.submit(FirmwareParser, root, builds['metadata-build'])
        ui_future = pool.submit(UiRuntime, root, builds['ui-build'])
        hardware_future = pool.submit(build_hardware, root, builds['hardware-build'])
        metadata, ui = metadata_future.result(), ui_future.result()
        hardware, identity = hardware_future.result()
    cases = [('ds_counter', False), ('ds_scroll', False), ('ds_i2c', False),
             ('ds_imu', False), ('ds_uart', False), ('ds_imu', True), ('ds_uart', True)]
    checks = []
    for name, negative in cases:
        source = FIXTURES / ('negative' if negative else '') / f'{name}.lua'
        initial = metadata.check(source)
        is_hardware = name not in ('ds_counter', 'ds_scroll')
        if is_hardware:
            modes = {mode: execute_hardware(hardware, source, mode, 5000, 5)
                     for mode in ('success', 'unavailable')}
            semantic = hardware_rules(name, modes)
            replay_identity = None
        else:
            replay = FIXTURES / f'{name}.replay.txt'
            replay_bytes = replay.read_bytes()
            replay_text = replay_bytes.decode('utf-8')
            modes = {'ui': ui.run(source, replay_text)}
            if name == 'ds_scroll':
                # Preserve the recorded checks/end and final click verbatim;
                # remove only the first gesture to obtain a controlled baseline.
                without_drag = '\n'.join(line for line in replay_text.splitlines()
                    if not line.startswith('pointer ') or int(line.split()[1]) >= 420) + '\n'
                modes['ui_without_drag'] = ui.run(source, without_drag)
            semantic = ui_rules(name, modes['ui'], modes.get('ui_without_drag'))
            replay_identity = {'path': str(replay), 'sha256': hashlib.sha256(replay_bytes).hexdigest()}
        preflight_ok = initial.get('ok') is True and initial.get('syntax') == 'pass'
        runtime_ok = all(interface_pass(result, is_hardware) for result in modes.values())
        semantic_ok = not semantic.failed
        expected_failures = ({'imu.wifi_unavailable_reason', 'imu.ble_unavailable_reason', 'imu.hid_unavailable_reason'}
                             if name == 'ds_imu' else {'uart.exact_ping_bytes'}) if negative else set()
        accepted = preflight_ok and runtime_ok and semantic_ok
        passed = (preflight_ok and runtime_ok and bool(semantic.failed)
                  and expected_failures.issubset(semantic.failed)) if negative else accepted
        checks.append({'name': ('negative/' if negative else '') + name, 'passed': passed,
                       'expected_accepted': not negative, 'accepted': accepted,
                       'metadata_syntax_pass': preflight_ok, 'interface_pass': runtime_ok,
                       'semantic_pass': semantic_ok, 'violations': semantic.failed,
                       'expected_rejection_rules': sorted(expected_failures), 'rules': semantic.items,
                       'source': str(source), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
                       'replay': replay_identity, 'preflight': initial, 'modes': modes})
    return {'ok': all(case['passed'] for case in checks), 'tests': len(checks),
            'passed': sum(case['passed'] for case in checks), 'firmware_root': str(root),
            'hardware_build': identity, 'checks': checks,
            'boundary': {'network_access': False, 'device_access': False,
                         'ui': 'Host scene/text and pointer replay; no LVGL pixel or physical touch acceptance.',
                         'hardware': 'Real Lua facades plus existing success/unavailable typed fixtures; no physical peripheral evidence.',
                         'uart': 'This suite checks accepted TX, short writes, retained loss diagnostics and cleanup. Read-failure injection and RX-cap behavior require the separate fault suite.',
                         'cleanup': 'Hardware adapter cleanup and handle counters; UI Host terminal frame. No claim about physical resource release.'}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firmware-root', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    try:
        report = run_suite(args.firmware_root.expanduser().resolve(strict=True), output)
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        report = {'ok': False, 'phase': 'environment', 'error': str(error)}
    destination = output / 'report.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    summary = {key: value for key, value in report.items() if key not in ('checks', 'boundary')}
    summary['report'] = str(destination)
    summary['checks'] = [{key: case[key] for key in ('name', 'passed', 'accepted', 'metadata_syntax_pass',
                         'interface_pass', 'semantic_pass', 'violations')} for case in report.get('checks', [])]
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if report['ok'] else 2 if report.get('phase') == 'environment' else 1


if __name__ == '__main__':
    raise SystemExit(main())
