# Link architecture

## Four bounded responsibilities

The UI owns the editable draft and explicit user confirmations. `DeviceClient`
owns a single Web Serial reader/writer, framing, request correlation, board
identity, a bounded log buffer, CAS file updates and unknown outcomes. The
simulator owns one isolated Worker and Lua VM per run. IndexedDB persists only
the current browser draft. None of them depends on a model provider, Studio
project system, or backend process.

Monaco owns native editing. React receives source snapshots but never echoes them
back with `setValue` after each keystroke: delayed effects could overwrite newer
input. An explicit editor revision remounts the editor only when the user imports
or reads a replacement document. Filename changes do not reset editor history.

## Source and result identity

Running the simulator captures the exact source at click time. Errors are only
attached to that source, not to a newer editor revision. Editing during a run is
allowed and explicitly indicates the running version differs. Starting another
run stops the previous simulation first.

Upload confirmation captures name, source, and the inspected device hash. The
firmware compare-and-swap prevents silent overwrites if the file changes between
inspection and commit. Once upload succeeds, that transaction is finished;
starting the script is a separate action. A run failure never reopens an old
upload confirmation or automatically repeats a write.

## Isolation and safety

- The application has no secrets, provider credentials or telemetry endpoint.
- Device and Lua output is text, never injected HTML. ANSI yields safe spans.
- Logs and frames are bounded/throttled. Pausing log follow does not stop UART reception.
- Serial permission is requested only from a user click. Opening the port releases
  DTR/RTS rather than intentionally pulsing reset, though OS drivers can still reset a board.
- The simulator cannot access Web Serial. Device writes cannot depend on simulation.
- The source lock binds Wasm build inputs to firmware commit/content and font assets.
  It does not assert that any plugged-in device has the same installed firmware.
- Static C UI fonts remain static; this target does not route them through runtime FreeType.

## Intentional scope limits

No AI, account, project tree, cloud backend, arbitrary filesystem browser, Lua
REPL, firmware flash UI, boot-script settings, or full ESP32 emulation. Link's
device file operations reflect the installed firmware's protected flag and
storage protocol, not old Studio assumptions.
