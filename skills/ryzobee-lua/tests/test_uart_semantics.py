#!/usr/bin/env python3
"""Strict UART response/LED regressions over the real frozen Lua facade.

Uses only deterministic host peers; does not open physical devices. The saved
DeepSeek positive and intermediate negative fixtures are executed unchanged.
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
SCENARIOS = ["clean_response", "response_then_failed", "continuous_rx_256_cap", "unavailable"]


def build(firmware_root, directory):
    components = ["ryz_runtime", "ryz_board", "ryz_lvgl", "ryz_tools",
                  "ryz_i2c_scan", "ryz_rgb", "ryz_monitor"]
    lua = firmware_root / "managed_components/georgik__lua"
    includes = [firmware_root / "host", firmware_root / "tests"]
    includes += [firmware_root / "components" / name / "include" for name in components]
    includes += [lua / "include", lua / "lua"]
    binary = directory / "uart-semantic-trials"
    command = [os.environ.get("CC", "cc"), "-std=c11", "-O1", "-g",
               "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined", "-DMAKE_LIB",
               "-include", str(firmware_root / "host/sdkconfig.h")]
    command += [flag for path in includes for flag in ("-I", str(path))]
    command += [str(HERE / "uart_semantics.c"),
                str(firmware_root / "components/ryz_runtime/app_runtime.c"),
                str(firmware_root / "components/ryz_runtime/app_tools.c"),
                str(lua / "lua/onelua.c"), "-lm", "-o", str(binary)]
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)
    return binary


def replay(binary, script, expectations):
    rows = []
    for scenario, name in enumerate(SCENARIOS):
        run = subprocess.run([str(binary), str(script), str(scenario)],
            capture_output=True, text=True, timeout=20,
            env={**os.environ, "UBSAN_OPTIONS": "halt_on_error=1"})
        if run.returncode not in (0, 1):
            raise RuntimeError(f"{script.name}/{name}: {run.returncode}; {run.stdout}; {run.stderr}")
        row = json.loads(run.stdout)
        expected = expectations[scenario]
        matches = (row["passed"] == expected and
                   run.returncode == (0 if expected else 1) and not run.stderr)
        row.update(name=name, returncode=run.returncode, stderr=run.stderr,
                   expected_pass=expected, regression_pass=matches)
        rows.append(row)
    return {"script": str(script), "sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
            "real_facade": True, "physical_hardware": False,
            "passed": all(row["regression_pass"] for row in rows), "scenarios": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firmware-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path,
                        help="Optional directory for full positive/negative JSON evidence")
    args = parser.parse_args()
    firmware_root = args.firmware_root.expanduser().resolve(strict=True)
    fixtures = HERE / "fixtures"
    with tempfile.TemporaryDirectory(prefix="ryz-uart-semantics-") as temporary:
        binary = build(firmware_root, Path(temporary))
        positive = replay(binary, fixtures / "ds_uart.lua", [True, True, True, True])
        negative = replay(binary, fixtures / "negative/ds_uart_intermediate.lua",
                          [True, False, False, True])
    report = {"passed": positive["passed"] and negative["passed"],
              "cases": 8, "positive": positive, "negative": negative}
    if args.output_dir:
        directory = args.output_dir.expanduser().resolve()
        directory.mkdir(parents=True, exist_ok=True)
        for name, evidence in (("positive", positive), ("negative", negative), ("report", report)):
            (directory / (name + ".json")).write_text(
                json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {"passed": report["passed"], "cases": report["cases"],
               "positive_outcomes": [row["passed"] for row in positive["scenarios"]],
               "negative_outcomes": [row["passed"] for row in negative["scenarios"]]}
    print(json.dumps(summary, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
