# Browser simulator

This target compiles the pinned RootMaker `app_runtime.c`, Lua 5.5, the production
LVGL scene bridge, static fonts and LVGL 9.5 to WebAssembly. Only panel, pointer,
clock and scheduler are browser adapters. Hardware tools/radios are unavailable,
not fabricated. Lua's production 16 KiB source / 256 KiB heap limits remain.

`ui.mount`, `ui.update`, `ui.poll` use real LVGL rendering. Legacy canvas operations
use RGB565 and the same 5x7 glyph table as firmware. This does not emulate ESP32
timing, electrical characteristics, DMA throughput or external peripherals.

## Rebuild

Install Emscripten **4.0.15**, CMake, Ninja and Node. Activate `emsdk_env.sh`.
Set `RYZOBEE_FIRMWARE_ROOT` to the sibling `ryzobee-firmware` checkout, whose HEAD
and source digest must match `firmware.lock.json`, then run:

```sh
node scripts/build-simulator.mjs
```

Managed Lua/LVGL components must already exist in that firmware checkout (restore
them using its locked ESP-IDF dependencies). The checked-in `public/simulator`
artifacts mean normal Link users need neither ESP-IDF, Node nor a compiler.
Explicit dependency upgrades use `node scripts/build-simulator.mjs --pin` and
must review the lock and regenerate artifacts. This is a build-source lock, not
a device-write authorization token or a prerequisite to send Lua to the board.

The Wasm module runs in a new Worker per run. The unchanged firmware instruction
hook calls the adapter's `pause_ms(0)`; Asyncify yields at most every 8 ms of hook
work so browser messages can request cancellation and pointer input. Cooperative
stop is primary; an 800 ms Worker termination fallback recovers crashes safely.
Each completed run destroys the Worker, isolating VM, globals and LVGL leases.

Run the focused browser checks with the development server running:

```sh
node simulator/test-browser.mjs
```

They exercise actual Chrome Workers and the checked-in WASM, including LVGL
button pixel changes, cancelled/overflowed gestures, Lua loops, native sleep,
log/frame floods, syntax diagnostics and restart. No serial device is accessed.

Third-party licenses are delivered under `public/simulator/licenses`: LVGL and
Lua are MIT; fonts are OFL. Ryzobee's product sources remain in their independent
repository and retain their existing ownership/license; this build does not
relicense them. Source pin hashes also cover their embedded font assets.
