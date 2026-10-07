# ToyStage

ToyStage is a browser-based play stage for bringing physical toys into digital scenes. This first slice captures and displays a live camera preview. Camera frames stay in the browser: the app does not upload, save, or record them.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A modern browser with camera access

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

The diagnostics panel reports the active camera's video size, reported frame rate and device label, browser version, and WebGL 2 availability. The rear camera is preferred where the browser supports facing-mode selection. User-facing previews are mirrored; environment-facing previews are not.

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
