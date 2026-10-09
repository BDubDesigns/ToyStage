import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("public/movenet/assets.json", root), "utf8"));
for (const [name, version] of Object.entries(manifest.packages)) {
  const installed = JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, root), "utf8"));
  if (installed.version !== version) throw new Error(`Benchmark package pin mismatch: ${name}`);
}
for (const [path, expected] of Object.entries(manifest.files)) {
  const contents = await readFile(new URL(`public/movenet/${path}`, root));
  if (contents.length !== expected.bytes || createHash("sha256").update(contents).digest("hex") !== expected.sha256) throw new Error(`Benchmark asset checksum mismatch: ${path}`);
  if (contents.length > 25 * 1024 * 1024) throw new Error(`Benchmark asset exceeds preview file budget: ${path}`);
  if (path.startsWith("wasm/")) {
    const packaged = await readFile(new URL(`node_modules/@tensorflow/tfjs-backend-wasm/dist/${path.slice(5)}`, root));
    if (!contents.equals(packaged)) throw new Error(`Benchmark WASM differs from package: ${path}`);
  }
}
const model = JSON.parse(await readFile(new URL("public/movenet/model.json", root), "utf8"));
for (const group of model.weightsManifest) for (const path of group.paths) {
  if (!/^[a-zA-Z0-9_-]+\.bin$/.test(path) || !manifest.files[path]) throw new Error("Model shard must be a pinned local asset.");
}
console.log("Verified pinned MoveNet Lightning v4 / TF.js 4.22.0 local assets.");
