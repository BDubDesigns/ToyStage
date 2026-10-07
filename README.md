# ToyStage

ToyStage is a browser-based play stage for bringing physical toys into digital scenes. The live camera is rendered through WebGL 2 over a test background. Camera frames stay in the browser: the app does not upload, save, or record them.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A modern browser with camera access and WebGL 2

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Camera access works on `localhost` and on HTTPS origins; browsers block camera access from ordinary HTTP sites. To test on a phone, use an HTTPS URL that the phone can reach.

## Checks

```sh
npm test
npm run build
npm run preview
```

The diagnostics panel reports the camera's decoded size, reported frame rate and device label, browser version, and WebGL 2 availability. It also shows measured rendered FPS, average frame interval, average CPU upload/draw submission time, drawing-buffer size, and mirror state. CPU submission time does **not** measure GPU execution time. Measurements update about once per second and reset when rendering resumes after switching tabs.

The rear camera is preferred where the browser supports facing-mode selection. User-facing previews are mirrored in the shader; environment-facing and unknown-facing previews are not. Video orientation comes from the browser's decoded `videoWidth`/`videoHeight`, including changes on rotation. The whole frame fits without cropping or stretching, inset over a procedural grid so both layers remain visible. The camera is still opaque: green-screen removal comes in issue #4.

The compositor targets 30 rendered frames per second, with a drawing buffer bounded to 1280×720 or 720×1280 depending on stage shape. It uploads from the hidden video directly into a GPU texture, without full-frame CPU readback. Rendering pauses in hidden tabs. Stop, camera failure, graphics-context loss, and page navigation release the stream and renderer resources; graphics-context loss displays a retry message.

## Deployment

Production site: [https://toystage.qcfailed.com](https://toystage.qcfailed.com)

The `.github/workflows/pages.yml` workflow runs tests and builds the app on every push to `main`, then deploys the `dist/` artifact to GitHub Pages. A failed test or build stops the workflow before deployment.

### One-time GitHub Pages setup

Before merging the deployment workflow, open **Settings → Pages** in `BDubDesigns/ToyStage` and:

1. Set **Build and deployment → Source** to **GitHub Actions**.
2. Enter `toystage.qcfailed.com` under **Custom domain** and save.
3. After GitHub verifies DNS and provisions the certificate, enable **Enforce HTTPS**.

### DNS record

At the DNS provider for `qcfailed.com`, create this record:

| Type | Host/name | Target |
| --- | --- | --- |
| CNAME | `toystage` | `bdubdesigns.github.io` |

The custom domain is configured in GitHub Pages settings. A repository-root `CNAME` file is not used for this Actions deployment.

## Manual camera check

On desktop and Android, start the camera, grant permission, confirm that the live preview and diagnostics populate, then stop and start it again. Rotate and resize the viewport while the preview is active. Also verify that a denied permission can be recovered after allowing camera access in browser settings, and check the visible messages with no camera available and with another app holding the camera.

For the compositor slice, also check:

- The grid stays visible around the camera; a round object stays round and all four camera edges remain visible in portrait and landscape.
- Text in the rear-camera image reads normally, the image stays upright after rotation, and a user-facing camera mirrors horizontally when the browser reports that facing mode.
- On the laptop and Pixel 10 Pro XL, leave the stage running for 30 seconds and record rendered FPS, frame interval, CPU submission time, camera size, and render size. The practical target is about 30 fps / 33 ms between rendered frames; slower cameras or device/browser load can reduce this. Synthetic browser checks cannot establish real-device performance.
- Stop/start several times, switch away and return, then navigate away and back. Camera-off state should hide the canvas and reset diagnostics; returning from a hidden tab should resume without stale timing spikes.
- To simulate context loss in desktop DevTools, run `document.querySelector('#stage-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`. Expect a visible graphics error and camera release. To retry this deliberately forced loss, call the extension's `restoreContext()` first, then **Try again**.
