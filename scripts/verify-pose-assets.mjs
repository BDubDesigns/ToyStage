import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("public/pose/assets.json", root), "utf8"));
const installed = JSON.parse(await readFile(new URL("node_modules/@mediapipe/tasks-vision/package.json", root), "utf8"));
if (installed.version !== manifest.packageVersion) throw new Error("Pose package and deployed WASM versions differ. Update them together.");
// Keep source parts below upload limits; deploy the exact upstream binary.
const wasm = Buffer.concat(await Promise.all(manifest.wasmSourceParts.map(path => readFile(new URL(path, root)))));
const expectedWasm = manifest.files["wasm/vision_wasm_module_internal.wasm"];
if (wasm.length !== expectedWasm.bytes || createHash("sha256").update(wasm).digest("hex") !== expectedWasm.sha256) {
  throw new Error("Pose WASM source parts checksum mismatch.");
}
await writeFile(new URL("public/pose/wasm/vision_wasm_module_internal.wasm", root), wasm);
for (const [path, expected] of Object.entries(manifest.files)) {
  const contents = await readFile(new URL(`public/pose/${path}`, root));
  if (contents.length !== expected.bytes || createHash("sha256").update(contents).digest("hex") !== expected.sha256) {
    throw new Error(`Pose asset checksum mismatch: ${path}`);
  }
  if (path.startsWith("wasm/")) {
    const packaged = await readFile(new URL(`node_modules/@mediapipe/tasks-vision/${path}`, root));
    if (!contents.equals(packaged)) throw new Error(`Deployed ${path} differs from the pinned package.`);
  }
}
console.log(`Verified pinned Pose Lite v1 and MediaPipe ${installed.version} assets.`);
