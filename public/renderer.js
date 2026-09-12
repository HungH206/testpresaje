'use strict';

const $ = (id) => document.getElementById(id);

const els = {
    camera: $('camera'),
    canvas: $('sampleCanvas'),
    prompt: $('cameraPrompt'),
    chart: $('signalChart'),
    status: $('statusBadge'),
    start: $('startButton'),
    stop: $('stopButton'),
    save: $('saveButton'),
    pulse: $('pulseValue'),
    confidence: $('confidenceText'),
    quality: $('qualityValue'),
    timer: $('timerValue'),
    pressure: $('pressureValue'),
    pressureText: $('pressureText'),
    hrv: $('hrvValue'),
    hrvText: $('hrvText'),
    hrvDetail: $('hrvDetailValue'),
    hrvDetailText: $('hrvDetailText'),
    sampleCount: $('sampleCount'),
    form: $('manualForm'),
    spo2: $('spo2Input'),
    temp: $('tempInput'),
    bp: $('bpInput'),
    history: $('historyList'),
    clearHistory: $('clearHistoryButton'),
    insightForm: $('insightForm'),
    insightPrompt: $('insightPrompt'),
    insightStatus: $('insightStatus'),
    insightResult: $('insightResult'),
    modeStatus: $('modeStatus'),
    modePipeline: $('modePipeline'),
    modeCamera: $('modeCamera'),
    modeMetrics: $('modeMetrics'),
    modePackets: $('modePackets'),
    modeLocalLink: $('modeLocalLink'),
    modeBridgeLink: $('modeBridgeLink'),
    modeIphoneLink: $('modeIphoneLink'),
};

const scan = {
    stream: null,
    raf: 0,
    startedAt: 0,
    samples: [],
    pulse: null,
    quality: 0,
    running: false,
    sdkStreaming: false,
    nativeSessionEnabled: false,
    nativeCameraMode: false,
    lastFrameSentAt: 0,
    frameInFlight: false,
    lastPixels: null,
};

const historyKey = 'vitalscan-history';
const maxSamples = 900;
const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const query = new URLSearchParams(window.location.search);
const forceNativeStreaming = query.get('native') === '1';
const forceBrowserBridge = query.get('bridge') === '1';
const useBrowserFrameBridge = forceBrowserBridge || (!isLocalHost && forceNativeStreaming);
const frameWidth = Math.max(160, Math.min(640, Number(query.get('w') || 480)));
const frameHeight = Math.max(120, Math.min(480, Number(query.get('h') || 270)));
const targetBridgeFps = Math.max(5, Math.min(30, Number(query.get('fps') || 15)));
const frameIntervalMs = Math.round(1000 / targetBridgeFps);

els.canvas.width = frameWidth;
els.canvas.height = frameHeight;

function setModeLinks() {
    const base = `${window.location.origin}${window.location.pathname}`;
    els.modeLocalLink.href = base;
    els.modeBridgeLink.href = `${base}?bridge=1&w=${frameWidth}&h=${frameHeight}&fps=${targetBridgeFps}`;
    els.modeIphoneLink.href = `${base}?native=1&w=320&h=240&fps=30`;
}

function describePipeline(status = {}) {
    if (!status.nativeSessionEnabled) return 'Hosted UI only';
    if (status.activeSource === 'camera') return 'Express -> SmartSpectra useCamera()';
    if (status.activeSource === 'custom') return 'iPhone/browser -> Express -> SmartSpectra useCustomInput()';
    if (useBrowserFrameBridge) return 'Ready for browser frame bridge';
    return 'Ready for native Mac camera';
}

function renderRunMode(status = {}) {
    const source = status.activeSource || (useBrowserFrameBridge ? 'custom' : 'camera');
    els.modeStatus.textContent = status.sessionActive ? 'SDK running' : 'Ready';
    els.modePipeline.textContent = describePipeline(status);
    els.modeCamera.textContent = source === 'camera'
        ? '1280x720 at 30fps'
        : `${frameWidth}x${frameHeight} at ${targetBridgeFps}fps`;
    els.modeMetrics.textContent = status.requestedMetricCount
        ? `${status.requestedMetricCount} cardio metrics`
        : '--';
    els.modePackets.textContent = String(status.metricsPacketCount || 0);
}

function setStatus(text, state) {
    els.status.textContent = text;
    els.status.dataset.state = state;
}

function resetScan() {
    scan.startedAt = performance.now();
    scan.samples = [];
    scan.pulse = null;
    scan.quality = 0;
    scan.sdkStreaming = false;
    scan.nativeCameraMode = false;
    scan.lastFrameSentAt = 0;
    scan.frameInFlight = false;
    scan.lastPixels = null;
    els.pulse.textContent = '--';
    els.pressure.textContent = '--';
    els.hrv.textContent = '--';
    els.hrvDetail.textContent = '--';
    els.quality.textContent = '--';
    els.confidence.textContent = 'Checking camera environment';
    els.timer.textContent = '0';
    els.sampleCount.textContent = '0 frames';
    els.save.disabled = true;
    drawChart();
}

async function startCamera() {
    const constraints = {
        video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
        },
        audio: false,
    };

    scan.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.camera.srcObject = scan.stream;
    await els.camera.play();
}

function stopCamera() {
    if (scan.stream) {
        for (const track of scan.stream.getTracks()) track.stop();
    }
    scan.stream = null;
    els.camera.srcObject = null;
}

function rgbaToBase64(data) {
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function readWholeFrame() {
    const video = els.camera;
    if (!video.videoWidth || !video.videoHeight) return null;

    const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, frameWidth, frameHeight);

    const pixels = ctx.getImageData(0, 0, frameWidth, frameHeight).data;
    let brightness = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    let motion = 0;

    for (let i = 0; i < pixels.length; i += 4) {
        red += pixels[i];
        green += pixels[i + 1];
        blue += pixels[i + 2];
        brightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;

        if (scan.lastPixels) {
            motion += Math.abs(pixels[i] - scan.lastPixels[i]);
            motion += Math.abs(pixels[i + 1] - scan.lastPixels[i + 1]);
            motion += Math.abs(pixels[i + 2] - scan.lastPixels[i + 2]);
        }
    }

    const pixelCount = frameWidth * frameHeight;
    brightness /= pixelCount;
    red /= pixelCount;
    green /= pixelCount;
    blue /= pixelCount;
    motion = scan.lastPixels ? motion / (pixelCount * 3) : 0;
    scan.lastPixels = new Uint8ClampedArray(pixels);

    const lightScore = Math.max(0, 1 - Math.abs(brightness - 125) / 125);
    const motionScore = Math.max(0, 1 - motion / 32);
    const colorBalance = Math.max(red, green, blue) - Math.min(red, green, blue);
    const colorScore = Math.max(0.2, 1 - colorBalance / 180);
    const quality = Math.round(lightScore * motionScore * colorScore * 100);

    return {
        t: (performance.now() - scan.startedAt) / 1000,
        brightness,
        motion,
        quality,
        rgbaBase64: rgbaToBase64(pixels),
    };
}

async function startSdkStream() {
    if (!isLocalHost && !forceNativeStreaming) {
        scan.nativeSessionEnabled = false;
        scan.sdkStreaming = false;
        els.confidence.textContent = 'Hosted iPhone camera test mode';
        return false;
    }

    await pollSdkStatus();

    if (!scan.nativeSessionEnabled) {
        scan.sdkStreaming = false;
        els.confidence.textContent = 'iPhone HTTPS camera test mode';
        return false;
    }

    try {
        const source = useBrowserFrameBridge ? 'custom' : 'camera';
        const response = await fetch('/api/smartspectra/session/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(source === 'camera'
                ? {
                    source,
                    width: 1280,
                    height: 720,
                    fps: 30,
                }
                : { source }),
        });
        const payload = await response.json();

        if (!response.ok) {
            scan.sdkStreaming = false;
            els.confidence.textContent = payload.error || 'SmartSpectra session unavailable';
            return;
        }

        scan.sdkStreaming = Boolean(payload.sessionActive);
        scan.nativeCameraMode = payload.activeSource === 'camera';
        els.confidence.textContent = scan.sdkStreaming
            ? (scan.nativeCameraMode ? 'SmartSpectra native camera running' : 'Streaming browser frames to SmartSpectra')
            : 'Local camera quality only';
        return scan.sdkStreaming;
    } catch {
        scan.sdkStreaming = false;
        els.confidence.textContent = 'Local camera quality only';
        return false;
    }
}

async function stopSdkStream() {
    if (!scan.sdkStreaming) return;

    try {
        await fetch('/api/smartspectra/session/stop', { method: 'POST' });
    } catch {
        // The local camera should still stop even if the SDK stop request fails.
    }

    scan.sdkStreaming = false;
    scan.nativeCameraMode = false;
}

async function sendFrameToSdk(frame) {
    if (!scan.sdkStreaming || scan.nativeCameraMode) return;
    if (scan.frameInFlight) return;

    const now = performance.now();
    if (now - scan.lastFrameSentAt < frameIntervalMs) return;
    scan.lastFrameSentAt = now;
    scan.frameInFlight = true;

    try {
        const response = await fetch('/api/smartspectra/frame', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                width: frameWidth,
                height: frameHeight,
                timestampUs: Math.round(performance.timeOrigin * 1000 + now * 1000),
                rgbaBase64: frame.rgbaBase64,
            }),
        });

        if (!response.ok) {
            scan.sdkStreaming = false;
            scan.nativeCameraMode = false;
            return;
        }

        const payload = await response.json();
        if (payload.accepted === false || payload.hostedMode) {
            scan.sdkStreaming = false;
            scan.nativeCameraMode = false;
            els.confidence.textContent = payload.message || 'Hosted iPhone camera test mode';
        }
    } catch {
        scan.sdkStreaming = false;
        scan.nativeCameraMode = false;
    } finally {
        scan.frameInFlight = false;
    }
}

function renderQuality(frame) {
    scan.quality = frame.quality;
    let label = 'Weak';
    if (frame.quality >= 70) label = 'Good';
    else if (frame.quality >= 40) label = 'Fair';

    els.quality.textContent = label;
    els.quality.dataset.quality = label.toLowerCase();
}

function normalizePoints(points) {
    if (points.length < 2) return [];

    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return points.map((point, index) => ({
        x: index / (points.length - 1),
        y: 1 - (point.value - min) / range,
    }));
}

function drawChart(series = null) {
    const canvas = els.chart;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#101923';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#233243';
    ctx.lineWidth = 1;

    for (let x = 0; x <= width; x += width / 6) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }

    for (let y = 0; y <= height; y += height / 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    const points = Array.isArray(series) && series.length > 1
        ? normalizePoints(series.slice(-240))
        : scan.samples.slice(-240).map((sample, index, samples) => ({
            x: samples.length <= 1 ? 0 : index / (samples.length - 1),
            y: 1 - sample.quality / 100,
        }));

    if (points.length < 2) return;

    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((point, index) => {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

async function pollSdkStatus() {
    if (!isLocalHost && !forceNativeStreaming) {
        scan.nativeSessionEnabled = false;
        els.insightStatus.textContent = 'Hosted camera test mode';
        return;
    }

    try {
        const response = await fetch('/api/smartspectra/status');
        const status = await response.json();
        const vitals = status.latestVitals || {};
        const pulseRate = vitals.pulseRate;
        scan.nativeSessionEnabled = Boolean(status.nativeSessionEnabled);
        renderRunMode(status);

        if (typeof pulseRate === 'number') {
            scan.pulse = Math.round(pulseRate);
            els.pulse.textContent = String(scan.pulse);
            els.save.disabled = false;
        }

        if (typeof vitals.arterialPressureTrace === 'number') {
            els.pressure.textContent = 'Active';
            els.pressureText.textContent = vitals.arterialPressureConfidence == null
                ? 'Waveform samples received'
                : `Confidence ${Math.round(vitals.arterialPressureConfidence)}%`;
        }

        if (vitals.hrv) {
            els.hrv.textContent = String(Math.round(vitals.hrv.rmssd));
            els.hrvText.textContent = vitals.hrv.stable
                ? `Stable, confidence ${Math.round(vitals.hrv.confidence)}%`
                : `Collecting, confidence ${Math.round(vitals.hrv.confidence)}%`;
            els.hrvDetail.textContent = `${Math.round(vitals.hrv.meanNn)} / ${Math.round(vitals.hrv.sdnn)}`;
            els.hrvDetailText.textContent = `Mean NN / SDNN ms, Baevsky ${Math.round(vitals.hrv.baevsky)}`;
        }

        if (Array.isArray(status.arterialPressureSeries) && status.arterialPressureSeries.length > 1) {
            drawChart(status.arterialPressureSeries);
        }

        if (status.activeSource === 'camera') {
            els.sampleCount.textContent = `${status.metricsPacketCount || 0} metric packets`;
            if (status.sessionStartedAt) {
                const elapsed = (Date.now() - new Date(status.sessionStartedAt).getTime()) / 1000;
                if (Number.isFinite(elapsed)) els.timer.textContent = String(Math.max(0, Math.floor(elapsed)));
            }
        }

        if (status.validationStatus?.hint) {
            els.confidence.textContent = status.validationStatus.hint;
        } else if (status.sessionActive) {
            els.confidence.textContent = 'SmartSpectra session active';
        }

        if (!status.nativeSessionEnabled) {
            els.insightStatus.textContent = 'Hosted camera test mode';
        } else {
            els.insightStatus.textContent = status.available
                ? `${status.requestedMetricCount} metrics configured`
                : 'SDK unavailable';
        }
    } catch {
        els.insightStatus.textContent = 'Status unavailable';
        renderRunMode();
    }
}

async function tick() {
    if (!scan.running) return;

    if (scan.nativeCameraMode) {
        await pollSdkStatus();
        scan.raf = window.setTimeout(tick, 1000);
        return;
    }

    const frame = readWholeFrame();
    if (frame) {
        scan.samples.push(frame);
        if (scan.samples.length > maxSamples) scan.samples.shift();
        els.timer.textContent = String(Math.floor(frame.t));
        els.sampleCount.textContent = `${scan.samples.length} frames`;
        renderQuality(frame);
        drawChart();
        sendFrameToSdk(frame);
    }

    if (scan.samples.length % 30 === 0) pollSdkStatus();
    scan.raf = requestAnimationFrame(tick);
}

async function startScan() {
    if (!navigator.mediaDevices?.getUserMedia && useBrowserFrameBridge) {
        els.prompt.textContent = 'Camera access is not available in this browser.';
        setStatus('No camera', 'error');
        return;
    }

    try {
        setStatus('Starting', 'busy');
        els.start.disabled = true;
        resetScan();
        const sdkStarted = await startSdkStream();
        if (!sdkStarted || !scan.nativeCameraMode) {
            await startCamera();
        }
        scan.running = true;
        els.stop.disabled = false;
        els.prompt.textContent = scan.nativeCameraMode
            ? 'SmartSpectra is using the Mac camera directly. Hold still with face and upper chest visible.'
            : (scan.sdkStreaming
                ? 'Streaming the iPhone camera to SmartSpectra. Hold still with face and upper chest visible.'
                : 'Hold still with face and upper chest in view. The whole frame is used.');
        setStatus('Scanning', 'running');
        tick();
    } catch (error) {
        els.start.disabled = false;
        els.stop.disabled = true;
        els.prompt.textContent = error.message || 'Camera permission was blocked.';
        setStatus('Camera blocked', 'error');
    }
}

async function stopScan() {
    scan.running = false;
    cancelAnimationFrame(scan.raf);
    clearTimeout(scan.raf);
    stopCamera();
    await stopSdkStream();
    els.start.disabled = false;
    els.stop.disabled = true;
    els.prompt.textContent = 'Scan stopped. Save the reading or start again.';
    setStatus('Ready', 'ready');
}

function loadHistory() {
    try {
        return JSON.parse(localStorage.getItem(historyKey) || '[]');
    } catch {
        return [];
    }
}

function saveHistory(items) {
    localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 20)));
    renderHistory();
}

function addReading(extra = {}) {
    const items = loadHistory();
    const reading = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pulse: scan.pulse,
        quality: scan.quality,
        spo2: extra.spo2 || '',
        temp: extra.temp || '',
        bp: extra.bp || '',
    };
    saveHistory([reading, ...items]);
}

function renderHistory() {
    const items = loadHistory();
    if (!items.length) {
        els.history.innerHTML = '<p class="empty">No readings saved yet.</p>';
        return;
    }

    els.history.innerHTML = items.map((item) => {
        const date = new Date(item.createdAt).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
        return `
            <article class="history-item">
                <strong>${date}</strong>
                <span>Pulse ${item.pulse || '--'} bpm</span>
                <span>Quality ${item.quality || 0}%</span>
                <span>SpO2 ${item.spo2 || '--'}%</span>
                <span>Temp ${item.temp || '--'} F</span>
                <span>BP ${item.bp || '--'}</span>
            </article>
        `;
    }).join('');
}

els.start.addEventListener('click', startScan);
els.stop.addEventListener('click', stopScan);
els.save.addEventListener('click', () => addReading());

els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    addReading({
        spo2: els.spo2.value.trim(),
        temp: els.temp.value.trim(),
        bp: els.bp.value.trim(),
    });
    els.form.reset();
});

els.clearHistory.addEventListener('click', () => {
    localStorage.removeItem(historyKey);
    renderHistory();
});

els.insightForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    els.insightResult.textContent = 'Requesting insight...';

    try {
        const response = await fetch('/api/smartspectra/insights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: els.insightPrompt.value.trim() }),
        });
        const payload = await response.json();

        if (!response.ok) {
            els.insightResult.textContent = payload.error || 'Insight request failed.';
            return;
        }

        els.insightResult.textContent = `Insight request ${payload.requestId} queued. SmartSpectra will return the analysis asynchronously.`;
    } catch (error) {
        els.insightResult.textContent = error.message || 'Insight request failed.';
    }
});

window.addEventListener('beforeunload', () => {
    if (scan.sdkStreaming) {
        navigator.sendBeacon?.('/api/smartspectra/session/stop');
    }
    stopCamera();
});

renderHistory();
setModeLinks();
renderRunMode();
drawChart();
pollSdkStatus();
