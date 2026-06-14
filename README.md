# VibeClown alpha playground

Static browser playground for the VibeClown compiler.

The playground uses the embedded WASM bundle, so it works on GitHub Pages without special MIME configuration for a separate `.wasm` file.

CodeMirror 6 is loaded as ESM modules from `esm.sh`; the compiler bundle itself is local.

For local testing, serve the folder over HTTP instead of opening `index.html` through `file://`:

```bash
npx http-server . -p 4177 -c-1
```
