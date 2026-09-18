# Link architecture

## Shared application services

`WorkspaceStore` owns the editor documents, active tab and IndexedDB persistence.
`SimulatorSession` owns one isolated Worker and Lua VM per run. `DeviceClient`
owns a single Web Serial reader/writer, framing, request correlation, board
identity, bounded logs, CAS file updates and unknown outcomes. React renders
these shared services and user confirmations; `CommandKernel` dispatches browser
commands to the same instances. None depends on a model provider, Studio project
system or backend process.

Monaco owns native editing. React receives source snapshots but never echoes them
back with `setValue` after each keystroke: delayed effects could overwrite newer
input. An explicit editor revision remounts the editor only when the user imports
or reads a replacement document, or a command updates that document. Filename
changes do not reset editor history.

## Browser MCP interface

The MCP server uses the official TypeScript SDK 1.30.0 and protocol revision
2025-11-25. The main page exposes `window.ryzobeeLink.request(message)`, accepting
standard JSON-RPC 2.0 MCP requests and notifications. The separate `agent.html`
entry provides a plain JSON-RPC textarea; `window.ryzobeeLinkAgent.connect(sessionId)`
performs `initialize` → `notifications/initialized` → `tools/list`, while
`request(sessionId, message)` sends raw MCP messages. A refreshed companion page
uses `ping` metadata to resume its still-initialized connection.

BroadcastChannel is a custom browser transport, not an HTTP MCP endpoint. It
carries raw JSON-RPC messages without an outer command envelope. Requests use
`params._meta["com.ryzobee.link/transport"]` for client/session routing; responses
carry routing in result metadata or error data. Discovery broadcasts standard
`ping` requests. Every control action uses `tools/call`, including
`link.request_control`, `link.control_status` and `link.request_result`.
Tools publish MCP input schemas and return standard content, structuredContent
and isError; simulator capture includes an MCP image content block.

The companion page does not load Monaco or own a second serial port. Both
entries use relative assets, and the offline cache is scoped to the deployment
path. URL fragments only prefill text and never dispatch commands.

`CommandOwner` keeps a volatile user grant and session ID. Only the main-page
approval button grants control. Reload, revocation, a bound device disconnect,
or an observed boot change invalidates authorization. Commands check the grant
again before committing after asynchronous work; device mutations also probe
live identity and check immediately before writing to the serial stream.
`device.connect` asks for a real main-page click to open the serial chooser.

JSON-RPC ids are strings or integers and must be unique within the MCP client
session. Reusing an id is a protocol error, including concurrent duplicates.
To inspect an uncertain tool call, send a new `tools/call` request for
`link.request_result` with the original id as its argument. The backend retains
up to 1024 operation fingerprints and 64 completed replies; evicting a reply
cannot replay a mutation. Result queries never dispatch the operation again.
An `accepted` tool result reports a started asynchronous operation, not runtime
success; inspect simulator status, device jobs, logs and frames. A transport
timeout is a local unknown-outcome error, not a fabricated MCP server response,
and never causes an automatic write retry. See the [MCP guide](agent-commands.md).

The separately installed [Link skill](../skills/ryzobee-link/README.md) teaches
browser operation. The [Lua skill](../skills/ryzobee-lua/README.md) covers script
authoring against firmware documentation. Neither embeds an AI model in Link.

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
- BroadcastChannel requires the same origin and storage partition. Channel paths
  route sessions but do not isolate malicious same-origin code: client IDs are
  visible and are not credentials. Trust the entire hosting origin, including
  other GitHub Pages repositories under the same `owner.github.io` hostname.
  A hidden companion-page URL is not an access-control boundary.
- Device and Lua output is text, never injected HTML. ANSI yields safe spans.
- Logs and frames are bounded/throttled. Pausing log follow does not stop UART reception.
- Serial permission is requested only from a user click. Opening the port releases
  DTR/RTS rather than intentionally pulsing reset, though OS drivers can still reset a board.
- The simulator cannot access Web Serial. Device writes cannot depend on simulation.
- The source lock binds Wasm build inputs to firmware commit/content and font assets.
  It does not assert that any plugged-in device has the same installed firmware.
- Static C UI fonts remain static; this target does not route them through runtime FreeType.

## Intentional scope limits

No built-in AI model, account, project tree, cloud backend, arbitrary filesystem
browser, Lua REPL, firmware flash UI, boot-script settings, or full ESP32 emulation. Link's
device file operations reflect the installed firmware's protected flag and
storage protocol, not old Studio assumptions. The AI command catalog does not
expose arbitrary Console commands, eval, device deletion or firmware flashing.
Browser and simulated-serial checks do not establish physical device acceptance.
