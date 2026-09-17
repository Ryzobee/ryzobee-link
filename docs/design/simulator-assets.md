# Simulator artwork sources

- Device surround: Figma `Ryzobee Firmware UI — Cyberpunk Menu`, file
  `FSiUaKHzDmhtoNBal977Sm`, page `RYZOBEE LINK / V5`, node `322:18930`
  (`Boundary / Physical Envelope with Side Notches`).
  `public/device/rootmaker-frame.svg` is the unmodified SVG_STRING export
  through the local Desktop Bridge on 2026-09-16: black fill, orange 2 px
  inner border, original rounded corners and side cutouts. The 240×240
  screen occupies 240/332 of the shell width, preserving the Figma ratio.
  The Figma document was not modified.
- `rootmaker-source.svg` retains the earlier Landingpage `65:511` export
  for provenance only; its white decorative surround is not used by Link.
- Idle screen: existing firmware `ryz_system_ui/assets/boot/screen.svg`,
  originally exported from `FSiUaKHzDmhtoNBal977Sm`, `155:3413`,
  `V5 / BOOT / ROOTMAKER A-FACE`. Only the outlined STARTING path is removed;
  the original RYZOBEE lettering and artwork are retained unchanged.
  The webpage renders `SIMULATOR` at the original footer position (y=214),
  matching the current Figma STARTING node `155:3424`: bundled Noto Sans
  Medium 500, 12 px, 16 px line height, 8% tracking, secondary gray.
  Typography scales proportionally with the 240×240 screen.
- The boot artwork and center rail are static. No animation, live progress,
  firmware dependency or hardware call is introduced. The idle overlay is
  removed when running and restored after stop; pointer coordinates remain
  relative to the 240×240 canvas, not the decorative surround.

## Fault screen (2026-09-17)

- Read through the local Desktop Bridge in the same file, page `Firmware Screens`:
  `189:4081` SCRIPT FAULT / RUNTIME, `190:4123` SYNTAX,
  `201:5558` LOG LINK UNAVAILABLE. No Figma nodes were modified.
- `public/device/fault-stripe.svg` is the exact SVG_STRING export of
  `201:5559` Hazard / Stripe. Header, type sizes, 240×240 geometry and
  44px HOME/VIEW LOG targets follow V5. Existing Teko/Noto faces and tokens are reused.
- Browser adaptation: no AP/QR service is invented. The central report panel
  shows the execution filename and line; VIEW LOG reveals Link diagnostics,
  HOME restores the existing SIMULATOR idle screen, not the device dashboard.
- Worker phase is retained for firmware-compatible LUA-R01/S01/T01 categories.
  Explicit unsupported-module messages use UI ONLY and
  “模拟器仅能模拟纯UI的界面”, with a warning rather than a code-error marker.
  Ordinary syntax/runtime failures retain their own category.
- The original diagnostic is logged once in Link. The full canvas is covered
  during a fault; its persistent physical boundary stays visible above the overlay.
