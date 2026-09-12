'use strict';

const placeholderKey = 'replace_with_your_test_key';
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
            faceMetrics: [],
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
            faceMetrics: [],
            decodeMetrics: null,
        };
    }
}

function getRequestedMetrics() {
    const sdk = loadSdkExports();
    return [
        ...(sdk.breathingMetrics || []),
        ...(sdk.cardioMetrics || []),
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
        requestedBundles: ['breathing', 'cardio', 'face'],
        requestedMetricCount: requestedMetrics.length,
        insightSupport: Boolean(sdk.SmartSpectraSDK),
        sessionActive: Boolean(activeSession),
        sessionStartedAt: activeSessionStartedAt,
        activeSource,
        processingStatus,
        validationStatus,
        latestVitals,
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
    });
}

function configureInputSource(session, options = {}) {
    const source = options.source || (options.filePath ? 'file' : 'camera');

    if (source === 'camera') {
        session.useCamera({
            deviceIndex: Number(options.deviceIndex || 0),
            width: Number(options.width || 0),
            height: Number(options.height || 0),
            fps: Number(options.fps || 0),
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
    if (activeSession) {
        return getSdkStatus();
    }

    const session = createSmartSpectraSession();
    const source = configureInputSource(session, options);

    processingStatus = null;
    validationStatus = null;
    lastInsight = null;
    lastError = null;

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
        latestVitals = readLatestVitals(buffer);
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
    if (!activeSession) {
        return getSdkStatus();
    }

    const session = activeSession;
    activeSession = null;
    activeSessionStartedAt = null;
    activeSource = null;

    if (typeof session.stopAsync === 'function') {
        await session.stopAsync();
    } else if (typeof session.stop === 'function') {
        session.stop();
    }

    if (typeof session.destroy === 'function') {
        await session.destroy();
    }

    return getSdkStatus();
}

function requestInsight(prompt) {
    if (!activeSession) {
        const error = new Error('Start a SmartSpectra session and collect valid breathing/cardio metrics before requesting an insight.');
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

function sendCustomFrame(frame) {
    const sdk = loadSdkExports();

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

    if (!width || !height || !timestampUs || !frame.rgbaBase64) {
        const error = new Error('Frame payload requires width, height, timestampUs, and rgbaBase64.');
        error.statusCode = 400;
        throw error;
    }

    const buffer = Buffer.from(frame.rgbaBase64, 'base64');
    const stride = width * 4;
    const expectedBytes = stride * height;

    if (buffer.length !== expectedBytes) {
        const error = new Error(`RGBA frame has ${buffer.length} bytes; expected ${expectedBytes}.`);
        error.statusCode = 400;
        throw error;
    }

    const sent = activeSession.sendFrame(
        buffer,
        width,
        height,
        stride,
        sdk.PixelFormat.kRGBA,
        timestampUs,
    );

    lastFrame = {
        width,
        height,
        stride,
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

    return {
        breathingRate: metrics.breathing?.rate?.at(-1)?.value ?? null,
        breathingConfidence: metrics.breathing?.rate?.at(-1)?.confidence ?? null,
        chestTrace: metrics.breathing?.upperTrace?.at(-1)?.value ?? null,
        abdomenTrace: metrics.breathing?.lowerTrace?.at(-1)?.value ?? null,
        pulseRate: metrics.cardio?.pulseRate?.at(-1)?.value ?? null,
        pulseConfidence: metrics.cardio?.pulseRate?.at(-1)?.confidence ?? null,
        arterialPressureTrace: metrics.cardio?.arterialPressureTrace?.at(-1)?.value ?? null,
        hrv: metrics.cardio?.hrv?.at(-1) ?? null,
        face: {
            landmarks: metrics.face?.landmarks?.at(-1)?.value ?? null,
            landmarksCount: metrics.face?.landmarks?.at(-1)?.value?.length ?? 0,
            blinking: metrics.face?.blinking?.at(-1)?.detected ?? null,
            talking: metrics.face?.talking?.at(-1)?.detected ?? null,
            expression: metrics.face?.expression?.at(-1) ?? null,
        },
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
