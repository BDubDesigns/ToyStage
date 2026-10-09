# Local benchmark assets

MoveNet is an opt-in benchmark only. Production Pose Mode remains MediaPipe.

- Runtime: `@tensorflow-models/pose-detection` **2.1.3**, `@tensorflow/tfjs-core`, `@tensorflow/tfjs-converter`, `@tensorflow/tfjs-backend-wasm` **4.22.0**, exact pins. The worker imports the pinned package's MoveNet detector module directly to exclude unrelated model runtimes; npm peer dependencies are installed but not bundled/served as other inference backends.
- Model: Google **MoveNet SinglePose Lightning v4**, float16-quantized TF.js weights; model input 192 × 192, 17 COCO landmarks. Upstream URL in the pinned package: `https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4`; it now redirects to Kaggle. These exact graph/shard files were extracted from [Google's versioned archive](https://www.kaggle.com/api/v1/models/google/movenet/tfJs/singlepose-lightning/4/download), not converted or fetched from a third-party mirror. [Model card](https://www.kaggle.com/models/google/movenet/tfJs/singlepose-lightning/4).
- WASM: byte-identical SIMD and plain single-thread binaries from backend-wasm 4.22.0. One explicit worker thread; no cross-origin-isolation requirement, nested worker pool, main-thread CPU fallback, or WebGL/WebGPU fallback. Feature detection chooses SIMD/plain WASM and the report records the actual selection. Initialization/inference errors terminate the worker and present a technical diagnostic plus retry.
- TensorFlow.js, detector code and Google model: Apache License 2.0, copyright Google LLC / TensorFlow Authors; see `LICENSE`. Upstream library sources retain their copyright/license headers. The app's own code remains under the repository license.

`assets.json` records source/version, byte lengths and SHA-256 integrity. `scripts/verify-benchmark-assets.mjs` runs during dev/build and checks all files, package pins, local-only shard paths, per-file preview budget and WASM package equality. Keep pins/copies/checksums together when upgrading. The raw candidate assets add about 5.3 MiB plus the bundled worker; largest shard is 4 MiB. All assets and frames are local to ToyStage origin; **there are no runtime CDN downloads or model/metrics uploads**. No pixel data, raw landmarks, identity or recordings are retained.

Both model workers enforce same-origin asset GETs before importing their runtimes; non-GET/remote fetch and XHR attempts are blocked, and fetch redirects fail. This also blocks the baseline MediaPipe SDK's delayed telemetry discovered by the full-duration browser test. The aggregate report includes only the blocked-request count.

Availability verified against official docs on 2026-10-08:
- [MoveNet installation, WASM, modelUrl and smoothing options](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/src/movenet/README.md)
- [TF.js WASM asset paths and SIMD support](https://github.com/tensorflow/tfjs/blob/master/tfjs-backend-wasm/README.md)
- [17/33 keypoint conventions](https://github.com/tensorflow/tfjs-models/blob/master/pose-detection/README.md)

Shared confidence gates do not make the two models' scores statistically equivalent. MoveNet omits MediaPipe toes/heels/finger landmarks and depth. No replacement of ball/gesture inputs is proposed here.
