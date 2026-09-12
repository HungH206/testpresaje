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
    sampleCount: $('sampleCount'),
    form: $('manualForm'),
    spo2: $('spo2Input'),
    temp: $('tempInput'),
    bp: $('bpInput'),
    history: $('historyList'),
    clearHistory: $('clearHistoryButton'),
};

const scan = {
    stream: null,
    raf: 0,
    startedAt: 0,
    samples: [],
    pulse: null,
    quality: 0,
    running: false,
};

const maxSamples = 900;
const historyKey = 'vitalscan-history';

function setStatus(text, state) {
    els.status.textContent = text;
    els.status.dataset.state = state;
}

function resetScan() {
    scan.startedAt = performance.now();
    scan.samples = [];
    scan.pulse = null;
    scan.quality = 0;
    els.pulse.textContent = '--';
    els.quality.textContent = '--';
    els.confidence.textContent = 'Collecting signal';
    els.timer.textContent = '0';
    els.sampleCount.textContent = '0 samples';
    els.save.disabled = true;
    drawChart();
}

async function startCamera() {
    const constraints = {
        video: {
            facingMode: { ideal: 'environment' },
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

function readFrame() {
    const video = els.camera;
    if (!video.videoWidth || !video.videoHeight) return null;

    const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
    const size = 64;
    const sx = Math.max(0, Math.floor(video.videoWidth / 2 - size / 2));
    const sy = Math.max(0, Math.floor(video.videoHeight / 2 - size / 2));
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    const data = ctx.getImageData(0, 0, size, size).data;
    let red = 0;
    let green = 0;
    let blue = 0;

    for (let i = 0; i < data.length; i += 4) {
        red += data[i];
        green += data[i + 1];
        blue += data[i + 2];
    }

    const pixels = data.length / 4;
    return {
        t: (performance.now() - scan.startedAt) / 1000,
        red: red / pixels,
        green: green / pixels,
        blue: blue / pixels,
    };
}

function normalize(values) {
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const centered = values.map((value) => value - avg);
    const peak = Math.max(...centered.map((value) => Math.abs(value))) || 1;
    return centered.map((value) => value / peak);
}

function estimatePulse() {
    const recent = scan.samples.slice(-420);
    if (recent.length < 180) return;

    const values = normalize(recent.map((sample) => sample.red));
    const times = recent.map((sample) => sample.t);
    const duration = times[times.length - 1] - times[0];
    if (duration < 8) return;

    const crossings = [];
    for (let i = 1; i < values.length; i++) {
        if (values[i - 1] < 0 && values[i] >= 0) crossings.push(times[i]);
    }

    const intervals = [];
    for (let i = 1; i < crossings.length; i++) {
        const gap = crossings[i] - crossings[i - 1];
        if (gap >= 0.35 && gap <= 1.5) intervals.push(gap);
    }

    const reds = recent.map((sample) => sample.red);
    const brightness = recent.reduce((sum, sample) => {
        return sum + sample.red + sample.green + sample.blue;
    }, 0) / (recent.length * 3);
    const redRange = Math.max(...reds) - Math.min(...reds);
    const coverageScore = Math.min(1, Math.max(0, (redRange - 1.5) / 14));
    const lightScore = brightness > 20 && brightness < 245 ? 1 : 0.35;
    scan.quality = Math.round(coverageScore * lightScore * 100);

    if (intervals.length >= 5) {
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        const bpm = Math.round(60 / median);

        if (bpm >= 40 && bpm <= 180) {
            scan.pulse = bpm;
            els.pulse.textContent = String(bpm);
            els.confidence.textContent = scan.quality >= 60 ? 'Stable estimate' : 'Weak signal';
            els.save.disabled = false;
        }
    }

    renderQuality();
}

function renderQuality() {
    let label = 'Weak';
    if (scan.quality >= 70) label = 'Good';
    else if (scan.quality >= 40) label = 'Fair';
    els.quality.textContent = label;
    els.quality.dataset.quality = label.toLowerCase();
}

function drawChart() {
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

    const samples = scan.samples.slice(-240);
    if (samples.length < 2) return;

    const values = normalize(samples.map((sample) => sample.red));
    ctx.strokeStyle = '#2dd4bf';
    ctx.lineWidth = 3;
    ctx.beginPath();
    values.forEach((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height / 2 - value * (height * 0.38);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

function tick() {
    if (!scan.running) return;

    const sample = readFrame();
    if (sample) {
        scan.samples.push(sample);
        if (scan.samples.length > maxSamples) scan.samples.shift();
        els.timer.textContent = String(Math.floor(sample.t));
        els.sampleCount.textContent = `${scan.samples.length} samples`;
        estimatePulse();
        drawChart();
    }

    scan.raf = requestAnimationFrame(tick);
}

async function startScan() {
    if (!navigator.mediaDevices?.getUserMedia) {
        els.prompt.textContent = 'Camera access is not available in this browser.';
        setStatus('No camera', 'error');
        return;
    }

    try {
        setStatus('Starting', 'busy');
        els.start.disabled = true;
        resetScan();
        await startCamera();
        scan.running = true;
        els.stop.disabled = false;
        els.prompt.textContent = 'Hold steady. A pulse estimate appears after several seconds.';
        setStatus('Scanning', 'running');
        tick();
    } catch (error) {
        els.start.disabled = false;
        els.stop.disabled = true;
        els.prompt.textContent = error.message || 'Camera permission was blocked.';
        setStatus('Camera blocked', 'error');
    }
}

function stopScan() {
    scan.running = false;
    cancelAnimationFrame(scan.raf);
    stopCamera();
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

window.addEventListener('beforeunload', stopCamera);

renderHistory();
drawChart();
