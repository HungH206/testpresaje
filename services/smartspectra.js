'use strict';

const placeholderKey = 'replace_with_your_test_key';
const { MetricsCache } = require('./metrics-cache');
const metricsCache = new MetricsCache();
let activeSession = null;
let activeSessionStartedAt = null;
let activeSource = null;
let processingStatus = null;
let validationStatus = null;
let latestVitals = null;
let lastMetricsAt = null;
let lastFrame = null;
let lastInsight = null;
let lastError = null;
let stoppingSession = null;
let metricsPacketCount = 0;
let arterialPressureSeries = [];
let customFrameShape = null;
const maxSeriesPoints = 600;

function getApiKey() {
    return process.env.SMARTSPECTRA_API_KEY || process.env.VITALSCAN_API_KEY || '';
}

function hasConfiguredApiKey() {
    const apiKey = getApiKey();
    return Boolean(apiKey && apiKey !== placeholderKey);
}

function loadSdkExports() {
    if (process.env.VERCEL === '1' && process.env.SMARTSPECTRA_NATIVE_ENABLED !== '1') {
        return {
            error: new Error('Native SmartSpectra sessions are disabled on Vercel serverless.'),
            SmartSpectraSDK: null,
            breathingMetrics: [],
            cardioMetrics: [],
            decodeMetrics: null,
        };
    }

    try {
        return require('@smartspectra/node-sdk');
    } catch (error) {
        return {
            error,
            SmartSpectraSDK: null,
            breathingMetrics: [],
            cardioMetrics: [],
            decodeMetrics: null,
        };
    }
}

function getRequestedMetrics() {
    const sdk = loadSdkExports();
    return [
        ...(sdk.cardioMetrics || []),
        ...(sdk.breathingMetrics || []),
        ...(sdk.faceMetrics || []),
    ];
}

function getSdkStatus() {
    const sdk = loadSdkExports();
    const requestedMetrics = getRequestedMetrics();

    return {
        available: Boolean(sdk.SmartSpectraSDK),
        deployTarget: process.env.VERCEL === '1' ? 'vercel-serverless' : 'express',
        nativeSessionEnabled: process.env.VERCEL !== '1' || process.env.SMARTSPECTRA_NATIVE_ENABLED === '1',
        version: sdk.SmartSpectraSDK?.version || null,
        hasApiKey: hasConfiguredApiKey(),
        requestedBundles: ['cardio', 'breathing', 'face'],
        requestedMetricCount: requestedMetrics.length,
        insightSupport: Boolean(sdk.SmartSpectraSDK),
        sessionActive: Boolean(activeSession),
        sessionStartedAt: activeSessionStartedAt,
        activeSource,
        processingStatus,
        sessionFailed: processingStatus === sdk.ProcessingStatus?.kError || Boolean(lastError && !lastError.retryable),
        validationStatus,
        latestVitals: activeSession ? metricsCache.snapshot() : null,
        metricsPacketCount,
        arterialPressureSeries,
        lastMetricsAt,
        lastFrame,
        lastInsight,
        lastError,
        error: sdk.error ? sdk.error.message : null,
    };
}

function createSmartSpectraSession() {
    const sdk = loadSdkExports();

    if (!sdk.SmartSpectraSDK) {
        throw new Error(sdk.error ? sdk.error.message : 'SmartSpectra SDK is not available.');
    }

    if (!hasConfiguredApiKey()) {
        throw new Error('Set SMARTSPECTRA_API_KEY or VITALSCAN_API_KEY before starting SmartSpectra.');
    }

    return new sdk.SmartSpectraSDK({
        apiKey: getApiKey(),
        requestedMetrics: getRequestedMetrics(),
        logLevel: sdk.SmartSpectraLogLevel?.kWarning,
    });
}

function configureInputSource(session, options = {}) {
    const source = options.source || (options.filePath ? 'file' : 'camera');

    if (source === 'camera') {
        session.useCamera({
            deviceIndex: Number(options.deviceIndex ?? process.env.CAMERA_INDEX ?? 0),
            width: Number(options.width ?? process.env.CAMERA_WIDTH ?? 1280),
            height: Number(options.height ?? process.env.CAMERA_HEIGHT ?? 720),
            fps: Number(options.fps ?? process.env.CAMERA_FPS ?? 30),
        });
        return 'camera';
    }

    if (source === 'file') {
        if (!options.filePath) {
            const error = new Error('filePath is required when source is "file".');
            error.statusCode = 400;
            throw error;
        }

        session.useFile(options.filePath, {
            timestampsPath: options.timestampsPath || null,
            interframeDelayMs: Number(options.interframeDelayMs || 0),
            startOffsetMs: Number(options.startOffsetMs || 0),
            maxDurationMs: Number(options.maxDurationMs || 0),
        });
        return 'file';
    }

    if (source === 'custom') {
        session.useCustomInput();
        return 'custom';
    }

    const error = new Error('source must be "camera", "file", or "custom".');
    error.statusCode = 400;
    throw error;
}

async function startSmartSpectraSession(options = {}) {
    if (stoppingSession) await stoppingSession;
    if (activeSession) {
        if (getSdkStatus().sessionFailed) {
            await stopSmartSpectraSession();
        } else {
            return getSdkStatus();
        }
    }

    const session = createSmartSpectraSession();
    const source = configureInputSource(session, options);

    processingStatus = null;
    validationStatus = null;
    latestVitals = null;
    metricsCache.clear();
    lastMetricsAt = null;
    metricsPacketCount = 0;
    arterialPressureSeries = [];
    lastInsight = null;
    lastError = null;
    lastFrame = null;
    customFrameShape = null;

    session.on('insight', (buffer, requestId) => {
        lastInsight = {
            requestId,
            receivedAt: new Date().toISOString(),
            encoded: Buffer.from(buffer).toString('base64'),
            decodeStatus: 'Insight protobuf decoder is not configured yet.',
        };
    });

    session.on('processingStatus', (status) => {
        processingStatus = status;
    });

    session.on('metrics', (buffer, timestampUs) => {
        metricsPacketCount += 1;
        const vitals = readLatestVitals(buffer);
        appendArterialPressure(vitals?.arterialPressureTraceSamples);
        if (vitals) delete vitals.arterialPressureTraceSamples;
        latestVitals = vitals;
        metricsCache.update(vitals);
        lastMetricsAt = {
            timestampUs,
            receivedAt: new Date().toISOString(),
        };
    });

    session.on('validationStatus', (code, timestampUs, hint) => {
        validationStatus = {
            code,
            timestampUs,
            hint,
            receivedAt: new Date().toISOString(),
        };
    });

    session.on('error', (code, message, retryable) => {
        if (lastError && !lastError.retryable) return;
        lastError = {
            code,
            message,
            retryable: Boolean(retryable),
            receivedAt: new Date().toISOString(),
        };
    });

    if (typeof session.start === 'function') {
        session.start();
    }

    activeSession = session;
    activeSessionStartedAt = new Date().toISOString();
    activeSource = source;

    return getSdkStatus();
}

async function stopSmartSpectraSession() {
    if (stoppingSession) return stoppingSession;
    if (!activeSession) {
        return getSdkStatus();
    }

    const session = activeSession;
    activeSession = null;
    activeSessionStartedAt = null;
    activeSource = null;
    metricsCache.clear();
    arterialPressureSeries = [];
    customFrameShape = null;

    stoppingSession = (async () => {
        try {
            if (typeof session.stopAsync === 'function') await session.stopAsync();
            else if (typeof session.stop === 'function') session.stop();
        } finally {
            if (typeof session.destroy === 'function') await session.destroy();
        }
        return getSdkStatus();
    })();
    try {
        return await stoppingSession;
    } finally {
        stoppingSession = null;
    }
}

function requestInsight(prompt) {
    if (!activeSession) {
        const error = new Error('Start a SmartSpectra session and collect valid cardio metrics before requesting an insight.');
        error.statusCode = 409;
        throw error;
    }

    if (!prompt || typeof prompt !== 'string') {
        const error = new Error('Insight prompt is required.');
        error.statusCode = 400;
        throw error;
    }

    const requestId = activeSession.requestInsight(prompt);
    return {
        requestId,
        prompt,
        requestedAt: new Date().toISOString(),
    };
}

function toNumber(value) {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value.toNumber === 'function') return value.toNumber();
    return Number(value);
}

function appendArterialPressure(samples = []) {
    if (!Array.isArray(samples) || samples.length === 0) return;

    for (const sample of samples) {
        arterialPressureSeries.push({
            t: toNumber(sample.timestamp),
            value: sample.value,
            confidence: sample.confidence ?? null,
        });
    }

    if (arterialPressureSeries.length > maxSeriesPoints) {
        arterialPressureSeries = arterialPressureSeries.slice(-maxSeriesPoints);
    }
}

function hasSameAspectRatio(a, b) {
    return Math.abs((a.width / a.height) - (b.width / b.height)) < 0.01;
}

function resizeRgbaNearest(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const output = Buffer.alloc(targetWidth * targetHeight * 4);
    for (let y = 0; y < targetHeight; y++) {
        const sourceY = Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / targetHeight));
        for (let x = 0; x < targetWidth; x++) {
            const sourceX = Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / targetWidth));
            const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
            const targetOffset = (y * targetWidth + x) * 4;
            output[targetOffset] = source[sourceOffset];
            output[targetOffset + 1] = source[sourceOffset + 1];
            output[targetOffset + 2] = source[sourceOffset + 2];
            output[targetOffset + 3] = source[sourceOffset + 3];
        }
    }
    return output;
}

function normalizeCustomFrameBuffer(buffer, width, height) {
    if (!customFrameShape) {
        customFrameShape = { width, height };
        return { buffer, width, height };
    }

    if (customFrameShape.width === width && customFrameShape.height === height) {
        return { buffer, width, height };
    }

    if (!hasSameAspectRatio(customFrameShape, { width, height })) {
        const error = new Error(`Camera aspect changed from ${customFrameShape.width}x${customFrameShape.height} to ${width}x${height}. Start a new scan with the camera orientation fixed.`);
        error.statusCode = 409;
        throw error;
    }

    return {
        buffer: resizeRgbaNearest(buffer, width, height, customFrameShape.width, customFrameShape.height),
        width: customFrameShape.width,
        height: customFrameShape.height,
    };
}

function sanitizeHrv(hrv) {
    if (!hrv) return null;

    return {
        rmssd: hrv.rmssd ?? null,
        meanNn: hrv.meanNn ?? null,
        sdnn: hrv.sdnn ?? null,
        baevsky: hrv.baevsky ?? null,
        timestamp: toNumber(hrv.timestamp),
        confidence: hrv.confidence ?? null,
        stable: Boolean(hrv.stable),
    };
}

function sendCustomFrame(frame) {
    const sdk = loadSdkExports();
    if (processingStatus === sdk.ProcessingStatus?.kError || (lastError && !lastError.retryable)) {
        const error = new Error(lastError?.message || 'SmartSpectra processing stopped. Start a new scan.');
        error.statusCode = 409;
        throw error;
    }

    if (!activeSession || activeSource !== 'custom') {
        return {
            accepted: false,
            sessionActive: Boolean(activeSession),
            activeSource,
            message: 'Start a SmartSpectra session with source "custom" before sending browser frames.',
        };
    }

    const width = Number(frame.width);
    const height = Number(frame.height);
    const timestampUs = Number(frame.timestampUs);

    if (!width || !height || !timestampUs || (!frame.rgbaBase64 && !frame.rgba)) {
        const error = new Error('Frame payload requires width, height, timestampUs, and rgbaBase64.');
        error.statusCode = 400;
        throw error;
    }

    let buffer = frame.rgba ? Buffer.from(frame.rgba) : Buffer.from(frame.rgbaBase64, 'base64');
    const stride = width * 4;
    const expectedBytes = stride * height;

    if (buffer.length !== expectedBytes) {
        const error = new Error(`RGBA frame has ${buffer.length} bytes; expected ${expectedBytes}.`);
        error.statusCode = 400;
        throw error;
    }

    const normalized = normalizeCustomFrameBuffer(buffer, width, height);
    buffer = normalized.buffer;
    const normalizedWidth = normalized.width;
    const normalizedHeight = normalized.height;
    const normalizedStride = normalizedWidth * 4;

    const sent = activeSession.sendFrame(
        buffer,
        normalizedWidth,
        normalizedHeight,
        normalizedStride,
        sdk.PixelFormat.kRGBA,
        timestampUs,
    );

    lastFrame = {
        width: normalizedWidth,
        height: normalizedHeight,
        stride: normalizedStride,
        sent: Boolean(sent),
        timestampUs,
        receivedAt: new Date().toISOString(),
    };

    return {
        accepted: Boolean(sent),
        ...lastFrame,
    };
}

function readLatestVitals(buffer) {
    const sdk = loadSdkExports();
    if (!sdk.decodeMetrics) return null;

    const metrics = sdk.decodeMetrics(buffer);
    if (Buffer.isBuffer(metrics)) return null;

    const expression = metrics.face?.expression?.at(-1)?.scores?.reduce((best, score) => !best || score.confidence > best.confidence ? score : best, null);
    const expressionNames = ['Unspecified', 'Angry', 'Contempt', 'Disgust', 'Fear', 'Happy', 'Neutral', 'Sad', 'Surprise'];
    return {
        breathingRate: metrics.breathing?.rate?.at(-1)?.value ?? null,
        breathingConfidence: metrics.breathing?.rate?.at(-1)?.confidence ?? null,
        faceExpression: expression ? (expressionNames[expression.type] || 'Unknown') : null,
        faceExpressionConfidence: expression?.confidence ?? null,
        faceLandmarkCount: metrics.face?.landmarks?.at(-1)?.value?.length ?? null,
        blinking: metrics.face?.blinking?.at(-1)?.detected ?? null,
        talking: metrics.face?.talking?.at(-1)?.detected ?? null,
        pulseRate: metrics.cardio?.pulseRate?.at(-1)?.value ?? null,
        pulseConfidence: metrics.cardio?.pulseRate?.at(-1)?.confidence ?? null,
        arterialPressureTrace: metrics.cardio?.arterialPressureTrace?.at(-1)?.value ?? null,
        arterialPressureConfidence: metrics.cardio?.arterialPressureTrace?.at(-1)?.confidence ?? null,
        arterialPressureTraceSamples: metrics.cardio?.arterialPressureTrace || [],
        hrv: sanitizeHrv(metrics.cardio?.hrv?.at(-1)),
    };
}

module.exports = {
    createSmartSpectraSession,
    getApiKey,
    getRequestedMetrics,
    getSdkStatus,
    hasConfiguredApiKey,
    readLatestVitals,
    requestInsight,
    sendCustomFrame,
    startSmartSpectraSession,
    stopSmartSpectraSession,
};
