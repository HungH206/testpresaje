# VitalScan

VitalScan is a browser-based wellness scanner for desktop and mobile. It uses the whole camera frame for face/chest/surrounding capture, can stream downscaled frames to SmartSpectra through Express custom input, and lets you save readings with optional manual values for SpO2, temperature, and blood pressure.

Camera estimates can be wrong. Do not use this app for emergencies, diagnosis, or medication decisions.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000` on your computer.

## Environment

Create `.env` from `.env.example` and put your test key there:

```bash
VITALSCAN_API_KEY=your_test_key_here
SMARTSPECTRA_API_KEY=your_test_key_here
```

The key stays on the server and is not committed to GitHub.

`SMARTSPECTRA_API_KEY` is used for the SmartSpectra Node SDK. `VITALSCAN_API_KEY` is still accepted as a fallback for local testing.

## Express App

The Express app is exported from `app.js`:

```js
const app = require('./app');
```

For platforms that need a factory instead:

```js
const { createApp } = require('./app');
const app = createApp();
```

## SmartSpectra Metrics

The server configures SmartSpectra with the breathing and cardio bundles:

```js
requestedMetrics: [...breathingMetrics, ...cardioMetrics]
```

The status endpoint confirms whether the SDK is available, whether an API key is configured, and how many metric codes are being requested:

```bash
curl http://localhost:3000/api/smartspectra/status
```

## LLM Insights

SmartSpectra LLM Insights require an active SDK session with buffered breathing and cardio metrics. The Express server exposes local session-backed routes:

```bash
curl -X POST http://localhost:3000/api/smartspectra/session/start \
  -H "Content-Type: application/json" \
  -d '{"source":"camera","deviceIndex":0,"width":1280,"height":720,"fps":30}'
curl -X POST http://localhost:3000/api/smartspectra/insights \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Summarize my current vital signs and flag anything unusual."}'
curl -X POST http://localhost:3000/api/smartspectra/session/stop
```

The Node SDK captures in the Node process for `source: "camera"`. For browser or phone camera capture, the scanner UI starts `source: "custom"` and streams downscaled whole-camera RGBA frames to:

```text
POST /api/smartspectra/frame
```

This uses `sendFrame(..., PixelFormat.kRGBA, timestampUs)` on the active SDK session.

The on-demand call returns the SmartSpectra `requestId`. Insight responses arrive asynchronously from the SDK `insight` event. The app stores the raw base64 protobuf payload for now; decoding the final `analysis` text needs the Insight protobuf schema from SmartSpectra data types.

Vercel serverless functions cannot hold the long-lived native SDK measurement buffer, so deployed `/api/smartspectra/insights` returns a clear `501` instead of silently pretending to work.

## Test On Phone

Mobile browsers generally require HTTPS before allowing camera access. Vercel gives you HTTPS automatically, so it is the fastest path for iPhone testing.

```bash
git add -A
git commit -m "Prepare iPhone camera deployment"
git push
```

Open the Vercel deployment URL on the iPhone, tap **Start Scan**, and allow camera access. The hosted Vercel version runs camera preview, whole-frame quality scoring, charting, and local history in the browser.

Live SmartSpectra frame streaming and LLM Insights require a persistent Node/Express process. Vercel serverless routes return clear `501` responses for those live session endpoints.

## Commit

Commit the app source and lockfile:

```bash
git add .gitignore .env.example README.md api/health.js public/index.html public/renderer.js public/styles.css package.json package-lock.json server.js vercel.json
git commit -m "Build VitalScan web app"
```
