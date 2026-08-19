# pdf.js (vendored)

Mozilla [pdf.js](https://github.com/mozilla/pdf.js), used by Dual Lens to
rasterise PDF pages so they can be compared like any other image.

- Package: `pdfjs-dist`
- Version: **6.2.108**
- License: Apache-2.0 (see `LICENSE`; the WebAssembly modules carry their own
  notices in `wasm/`)

It is vendored rather than pulled from a CDN so the app stays self-contained
and keeps working offline. `pdf.min.mjs` is imported lazily — nothing here is
downloaded until the first PDF is opened.

These are the **legacy** builds (`pdfjs-dist/legacy/build/`). They carry the
polyfills the default builds omit — without them pdf.js 6 needs
`Map.prototype.getOrInsertComputed`, which browsers as recent as Chromium 141
do not have.

## Contents

| Path                  | Why it is here                                            |
| --------------------- | --------------------------------------------------------- |
| `pdf.min.mjs`         | Main library, legacy build (dynamically imported)          |
| `pdf.worker.min.mjs`  | Parsing/rendering worker (`GlobalWorkerOptions.workerSrc`) |
| `standard_fonts/`     | Substitutes for the standard 14 fonts when not embedded    |
| `cmaps/`              | Predefined CMaps, needed for CJK text                      |
| `iccs/`               | Built-in ICC profiles for colour conversion                |
| `wasm/`               | JBIG2 / JPEG 2000 decoders and the qcms colour engine      |

`wasm/quickjs-eval.*` is deliberately omitted: Dual Lens renders with
`isEvalSupported: false`, so PDF form scripting is never executed.

## Updating

```sh
npm pack pdfjs-dist@<version>          # or: npm install pdfjs-dist@<version>
```

Copy `legacy/build/pdf.min.mjs`, `legacy/build/pdf.worker.min.mjs`, `standard_fonts/`,
`cmaps/`, `iccs/`, `LICENSE`, and everything in `wasm/` except
`quickjs-eval.*` into this directory, then bump the version recorded above.
