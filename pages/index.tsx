import Head from 'next/head';
import Script from 'next/script';

export default function Home() {
    return (
        <>
            <Head>
                <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
                <meta name="theme-color" content="#0f1720" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-title" content="VitalScan" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <title>VitalScan</title>
                <link rel="manifest" href="/manifest.webmanifest" />
                <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
                <link rel="apple-touch-icon" href="/icons/icon.svg" />
                <link rel="stylesheet" href="/styles.css?v=20260912-baseline-phone" />
            </Head>

            <header className="app-header">
                <div>
                    <p className="eyebrow">whole-camera wellness check</p>
                    <h1>VitalScan</h1>
                </div>
                <span id="statusBadge" className="status">Ready</span>
            </header>

            <main className="shell">
                <section className="scanner" aria-label="Camera scanner">
                    <div className="livekit-settings">
                        <label htmlFor="livekitCode">Access code optional</label>
                        <input id="livekitCode" type="password" autoComplete="off" />
                        <span id="connectionState" role="status">Not connected</span>
                        <span id="livekitRates" role="status">Capture -- fps / Received -- fps / Accepted -- fps</span>
                    </div>
                    <div className="camera-tabs" role="tablist" aria-label="Camera source">
                        <button id="macCameraTab" type="button" role="tab" aria-selected="true" aria-controls="localCameraPanel">Use This Camera</button>
                        <button id="phoneCameraTab" type="button" role="tab" aria-selected="false" aria-controls="phoneCameraPanel" tabIndex={-1}>Phone Dashboard</button>
                    </div>
                    <div id="phoneCameraPanel" role="tabpanel" aria-labelledby="phoneCameraTab" hidden>
                        <a id="phoneScanLink" hidden target="_blank" rel="noopener noreferrer">Open phone scanner</a>
                        <button id="copyPhoneLink" type="button" hidden>Copy Phone Link</button>
                        <p id="phoneLinkStatus">Phone link available on your HTTPS deployment</p>
                        <button id="connectDashboard" type="button">Connect Dashboard</button>
                        <p id="phoneConnection" role="status">Waiting for phone</p>
                    </div>
                    <div id="localCameraPanel" role="tabpanel" aria-labelledby="macCameraTab">
                        <div className="camera-wrap">
                            <video id="camera" autoPlay playsInline muted />
                            <canvas id="sampleCanvas" width="320" height="240" hidden />
                            <div className="target-ring" aria-hidden="true" />
                            <div id="cameraPrompt" className="camera-prompt">Frame your face and upper chest with steady lighting, then start a scan.</div>
                        </div>

                        <div className="toolbar">
                            <button id="startButton" type="button">Start Scan</button>
                            <button id="stopButton" type="button" disabled>Stop</button>
                            <button id="saveButton" type="button" disabled>Save Baseline</button>
                        </div>
                    </div>
                </section>

                <section className="readouts" aria-label="Physiological baseline">
                    <article className="metric primary">
                        <span>Pulse</span>
                        <strong><span id="pulseValue">--</span> bpm</strong>
                        <small id="confidenceText">Waiting for scan</small>
                    </article>
                    <article className="metric primary">
                        <span>Respiration</span>
                        <strong><span id="breathingValue">--</span> brpm</strong>
                        <small id="breathingText">Waiting for breathing measurements</small>
                    </article>
                    <article className="metric primary">
                        <span>Quality</span>
                        <strong id="qualityValue">--</strong>
                        <small>Stationary capture required</small>
                    </article>
                    <article className="metric diagnostic-metric">
                        <span>Face analysis</span>
                        <strong id="faceValue">--</strong>
                        <small id="faceText">Waiting for face measurements</small>
                    </article>
                    <article className="metric diagnostic-metric">
                        <span>Scan time</span>
                        <strong><span id="timerValue">0</span>s</strong>
                        <small>Baseline saves when pulse, respiration, and quality are ready</small>
                    </article>
                    <article className="metric diagnostic-metric">
                        <span>Pressure waveform</span>
                        <strong id="pressureValue">--</strong>
                        <small id="pressureText">Shape only, not blood pressure</small>
                    </article>
                    <article className="metric">
                        <span>Optional HRV</span>
                        <strong><span id="hrvValue">--</span> ms</strong>
                        <small id="hrvText">Not required for demo baseline</small>
                    </article>
                    <article className="metric diagnostic-metric">
                        <span>HRV details</span>
                        <strong id="hrvDetailValue">--</strong>
                        <small id="hrvDetailText">Mean NN, SDNN, Baevsky after confidence is available</small>
                    </article>
                </section>

                <section className="run-mode" aria-label="SmartSpectra run mode">
                    <div className="section-heading">
                        <h2>Run Mode</h2>
                        <span id="modeStatus">Checking SDK</span>
                    </div>
                    <dl className="mode-grid">
                        <div>
                            <dt>Pipeline</dt>
                            <dd id="modePipeline">--</dd>
                        </div>
                        <div>
                            <dt>Camera Input</dt>
                            <dd id="modeCamera">--</dd>
                        </div>
                        <div>
                            <dt>Metrics</dt>
                            <dd id="modeMetrics">--</dd>
                        </div>
                        <div>
                            <dt>Packets</dt>
                            <dd id="modePackets">0</dd>
                        </div>
                    </dl>
                </section>

                <section className="chart-section" aria-label="Pulse signal chart">
                    <div className="section-heading">
                        <h2>Relative Arterial Pressure</h2>
                        <span id="sampleCount">0 samples</span>
                    </div>
                    <canvas id="signalChart" width="900" height="260" />
                </section>

                <section className="manual-entry" aria-label="Manual health log">
                    <div className="section-heading">
                        <h2>Health Log</h2>
                        <button id="clearHistoryButton" className="quiet" type="button">Clear</button>
                    </div>
                    <form id="manualForm">
                        <label>
                            SpO2 %
                            <input id="spo2Input" inputMode="numeric" min="70" max="100" type="number" placeholder="98" />
                        </label>
                        <label>
                            Temperature F
                            <input id="tempInput" inputMode="decimal" min="90" max="110" step="0.1" type="number" placeholder="98.6" />
                        </label>
                        <label>
                            Blood pressure
                            <input id="bpInput" inputMode="text" type="text" placeholder="120/80" />
                        </label>
                        <button type="submit">Add Manual Reading</button>
                    </form>
                    <div id="historyList" className="history-list" />
                </section>

                <section className="insights" aria-label="AI insights" hidden>
                    <div className="section-heading">
                        <h2>AI Insight</h2>
                        <span id="insightStatus">SmartSpectra optional</span>
                    </div>
                    <form id="insightForm">
                        <label>
                            Prompt
                            <input id="insightPrompt" type="text" defaultValue="Summarize my current vital signs and flag anything unusual." />
                        </label>
                        <button type="submit">Request Insight</button>
                    </form>
                    <div id="insightResult" className="insight-result">Start a SmartSpectra SDK session before requesting grounded insights.</div>
                </section>

                <aside className="notice">
                    Relative arterial pressure is waveform shape only, not a blood pressure measurement. Whole-camera estimates are for wellness tracking only and can be wrong. Do not use this app for emergencies, diagnosis, or medication decisions.
                </aside>
            </main>

            <Script src="/livekit.bundle.js" strategy="afterInteractive" />
            <Script src="/renderer.js?v=20260912-baseline-phone" strategy="afterInteractive" />
        </>
    );
}
