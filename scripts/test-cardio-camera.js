'use strict';

require('dotenv').config();

const {
    SmartSpectraSDK,
    SmartSpectraLogLevel,
    ProcessingStatus,
    ValidationCode,
    cardioMetrics,
} = require('@smartspectra/node-sdk');
const { decodeMetrics } = require('@smartspectra/node-sdk/messages');

const apiKey = process.env.SMARTSPECTRA_API_KEY || process.env.VITALSCAN_API_KEY;
const placeholderKey = 'replace_with_your_test_key';
const durationMs = Number(process.env.TEST_DURATION_MS || 70_000);

if (!apiKey || apiKey === placeholderKey) {
    console.error('Set SMARTSPECTRA_API_KEY in .env before running this test.');
    process.exit(1);
}

const statusNames = Object.fromEntries(
    Object.entries(ProcessingStatus).map(([name, value]) => [value, name.replace(/^k/, '')]),
);
const validationNames = Object.fromEntries(
    Object.entries(ValidationCode).map(([name, value]) => [value, name.replace(/^k/, '')]),
);

let latestPulse = null;
let latestPressure = null;
let latestPressureConfidence = null;
let latestHrv = null;
let metricsPackets = 0;
let lastLogAt = 0;
let sdk = null;

function round(value) {
    return typeof value === 'number' ? Math.round(value * 10) / 10 : null;
}

function printSummary(prefix = 'summary') {
    const hrv = latestHrv
        ? `HRV rmssd=${round(latestHrv.rmssd)}ms meanNN=${round(latestHrv.meanNn)}ms sdnn=${round(latestHrv.sdnn)}ms baevsky=${round(latestHrv.baevsky)} conf=${round(latestHrv.confidence)} stable=${Boolean(latestHrv.stable)}`
        : 'HRV waiting for 60s window';

    console.log(
        `[${prefix}] packets=${metricsPackets} pulse=${round(latestPulse) ?? '--'} bpm ` +
        `pressure=${round(latestPressure) ?? '--'} conf=${round(latestPressureConfidence) ?? '--'} ${hrv}`,
    );
}

async function shutdown(code = 0) {
    if (!sdk) process.exit(code);

    try {
        if (typeof sdk.stopAsync === 'function') await sdk.stopAsync();
        else sdk.stop();
    } catch (error) {
        console.error('stop failed:', error.message);
    }

    try {
        await sdk.destroy();
    } catch (error) {
        console.error('destroy failed:', error.message);
    }

    printSummary('final');
    process.exit(code);
}

sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...cardioMetrics],
    logLevel: SmartSpectraLogLevel.kWarning,
});

sdk.on('processingStatus', (status) => {
    console.log(`[status] ${statusNames[status] || status}`);
});

sdk.on('validationStatus', (code, timestampUs, hint) => {
    const name = validationNames[code] || code;
    console.log(`[validation] ${name} ts=${timestampUs} ${hint || ''}`.trim());
});

sdk.on('metrics', (buffer) => {
    metricsPackets += 1;
    const metrics = decodeMetrics(buffer);
    latestPulse = metrics.cardio?.pulseRate?.at(-1)?.value ?? latestPulse;
    latestPressure = metrics.cardio?.arterialPressureTrace?.at(-1)?.value ?? latestPressure;
    latestPressureConfidence =
        metrics.cardio?.arterialPressureTrace?.at(-1)?.confidence ?? latestPressureConfidence;
    latestHrv = metrics.cardio?.hrv?.at(-1) ?? latestHrv;

    const now = Date.now();
    if (now - lastLogAt > 5000) {
        lastLogAt = now;
        printSummary('live');
    }
});

sdk.on('error', (code, message, retryable) => {
    console.error(`[sdk-error] code=${code} retryable=${Boolean(retryable)} ${message}`);
});

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

console.log(`Starting SmartSpectra cardio camera test for ${Math.round(durationMs / 1000)}s...`);
console.log('Setup: stable camera, face and upper chest visible, steady light, no talking or chewing.');

try {
    sdk.useCamera({
        deviceIndex: Number(process.env.CAMERA_INDEX || 0),
        width: Number(process.env.CAMERA_WIDTH || 1280),
        height: Number(process.env.CAMERA_HEIGHT || 720),
        fps: Number(process.env.CAMERA_FPS || 30),
    });
    sdk.start();
} catch (error) {
    console.error(`[start-failed] code=${error.code ?? 'JS'} retryable=${Boolean(error.retryable)} ${error.message}`);
    shutdown(1);
}

setTimeout(() => shutdown(0), durationMs);
