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

This prototype focuses on SmartSpectra cardio metrics:

```js
requestedMetrics: [...cardioMetrics]
```

That covers pulse rate, relative arterial pressure waveform, and HRV. The status endpoint confirms whether the SDK is available, whether an API key is configured, and how many metric codes are being requested:

```bash
curl http://localhost:3000/api/smartspectra/status
```

## LLM Insights

SmartSpectra LLM Insights are still wired, but grounded vitals insights may require breathing plus cardio depending on your subscription and prompt. The Express server exposes local session-backed routes:

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

This uses `sendFrame(..., PixelFormat.kRGBA, timestampUs)` on the active SDK session. Hosted Vercel/iPhone test mode skips this by default and stays browser-only; add `?native=1` only when the URL points at a persistent Node server that can hold an SDK session.

Relative arterial pressure is waveform shape only. It is not systolic or diastolic blood pressure. HRV needs about 60 seconds, and only applies when pulse is in the valid range. Both need a stationary subject, stable camera, face and upper chest visible, and steady lighting.

## Local Cardio Verification

Use the direct SDK camera test before debugging iPhone/browser streaming:

```bash
SMARTSPECTRA_API_KEY=your_key_here npm run test:cardio
```

This runs SmartSpectra with `useCamera()` for 70 seconds and logs validation status, pulse, relative arterial pressure waveform samples, and HRV when the 60-second window is reached.

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

Live SmartSpectra frame streaming and LLM Insights require a persistent Node/Express process. Vercel serverless routes return clean no-op JSON responses for those live session endpoints so iPhone camera testing stays smooth.

## Deploy The LiveKit Agent

The scan processor should run as a LiveKit Agent. Keep the Next.js app on Vercel and deploy the realtime processor with LiveKit Cloud.

Set `LIVEKIT_AGENT_NAME` in Vercel so the token endpoint explicitly dispatches the agent into the scan room:

```dotenv
LIVEKIT_AGENT_NAME=vitalscan-agent
```

Deploy the agent with the LiveKit CLI:

```bash
lk cloud auth
lk agent create .
lk agent status
lk agent logs
```

Set these LiveKit Agent secrets:

```dotenv
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_ROOM=vitalscan-test
LIVEKIT_AGENT_NAME=vitalscan-agent
SMARTSPECTRA_API_KEY=your_presage_key
```

For local development without deploying an agent, `npm run worker` still runs the same processor from your Mac.
You can also run the Agent Framework entrypoint locally:

```bash
npm run agent:dev
```

## Commit

Commit the app source and lockfile:

```bash
git add .gitignore .env.example README.md api/health.js public/index.html public/renderer.js public/styles.css package.json package-lock.json server.js vercel.json
git commit -m "Build VitalScan web app"
```
