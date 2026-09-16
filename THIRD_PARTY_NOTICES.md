# Third-party notices

This private product repository does not assign a new license to Ryzobee's brand,
Studio source, or firmware source. Their ownership and existing terms remain.

## Browser application

- React and React DOM — Meta Platforms, Inc. and affiliates, MIT.
- Monaco Editor — Microsoft Corporation, MIT.
- VS Code Codicons — Microsoft Corporation, **CC BY 4.0 for icon artwork**, MIT for code. Icons are used through the unmodified `@vscode/codicons` package. Source: <https://github.com/microsoft/vscode-codicons>.
- Teko, Noto Sans, Noto Sans SC — SIL Open Font License 1.1. The original WOFF2 subsets, unicode ranges, manifest and license files are reused from Ryzobee Studio. Original font sources/checksums: `src/assets/fonts/manifest.json`; notices: `public/fonts/`.

Runtime dependency license texts are distributed in `public/licenses/`.
Build/test dependencies retain their npm package licenses in `node_modules`.

## WebAssembly simulator

Lua and LVGL are MIT-licensed; embedded fonts are OFL-licensed. Original license
texts and font notices are distributed in `public/simulator/licenses/`.
Emscripten is a build-time tool, MIT/NCSA dual licensed. This target does not
require commercial LVGL Pro, a remote compiler, or a Node runtime on the user's
machine. See `simulator/README.md` and the checked-in build provenance.

## Brand assets

The Ryzobee logo is reused unmodified from `ryzobee-studio/logo/ryzobee-logo-low-detail.svg`.
It is not a Codicon or generic open-source icon; no third-party brand rights are
granted by this repository.
