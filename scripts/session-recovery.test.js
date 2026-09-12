'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
    const instances = [];
    class SDK {
        constructor() { this.listeners = {}; instances.push(this); }
        on(event, callback) { this.listeners[event] = callback; }
        useCustomInput() {}
        start() {}
        async stopAsync() { if (this.stopError) throw new Error('stop failed'); }
        async destroy() { this.destroyed = true; }
        sendFrame() { throw new Error('Failed sessions must not receive frames'); }
    }
    const context = {
        module: { exports: {} }, Buffer,
        process: { env: { SMARTSPECTRA_API_KEY: 'test-only' } },
        require: name => name === './metrics-cache' ? require('../services/metrics-cache')
            : ({ SmartSpectraSDK: SDK, cardioMetrics: [1, 2, 3], PixelFormat: { kRGBA: 1 }, ProcessingStatus: { kError: 5 } }),
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../services/smartspectra'), 'utf8'), context);
    return { service: context.module.exports, instances };
}

test('processing error blocks frames and a new scan replaces the failed session', async () => {
    const { service, instances } = fixture();
    await service.startSmartSpectraSession({ source: 'custom' });
    instances[0].listeners.processingStatus(5);
    instances[0].listeners.error(8, 'Processing failed', true);
    assert.equal(service.getSdkStatus().sessionFailed, true);
    assert.throws(() => service.sendCustomFrame({}), /Processing failed/);
    await service.startSmartSpectraSession({ source: 'custom' });
    assert.equal(instances[0].destroyed, true);
    assert.equal(instances.length, 2);
    assert.equal(service.getSdkStatus().sessionFailed, false);
});

test('later errors do not overwrite the first fatal error', async () => {
    const { service, instances } = fixture();
    await service.startSmartSpectraSession({ source: 'custom' });
    instances[0].listeners.error(11, 'Frame timestamp gap', false);
    instances[0].listeners.error(1, 'Invalid state', false);
    assert.equal(service.getSdkStatus().lastError.message, 'Frame timestamp gap');
});

test('destroy runs even if native stop fails', async () => {
    const { service, instances } = fixture();
    await service.startSmartSpectraSession({ source: 'custom' });
    instances[0].stopError = true;
    await assert.rejects(service.stopSmartSpectraSession(), /stop failed/);
    assert.equal(instances[0].destroyed, true);
    assert.equal(service.getSdkStatus().sessionActive, false);
});

test('custom input normalizes same-aspect size changes before native processing', async () => {
    const { service, instances } = fixture();
    await service.startSmartSpectraSession({ source: 'custom' });
    const sentFrames = [];
    instances[0].sendFrame = (_buffer, width, height, stride) => {
        sentFrames.push({ width, height, stride });
        return true;
    };
    const rgba = Buffer.alloc(2 * 1 * 4);
    assert.equal(service.sendCustomFrame({ width: 2, height: 1, timestampUs: 1000, rgba }).accepted, true);
    assert.equal(service.sendCustomFrame({
        width: 4,
        height: 2,
        timestampUs: 2000,
        rgba: Buffer.alloc(4 * 2 * 4),
    }).accepted, true);
    assert.deepEqual(sentFrames, [
        { width: 2, height: 1, stride: 8 },
        { width: 2, height: 1, stride: 8 },
    ]);
});

test('custom input rejects aspect changes before native processing', async () => {
    const { service, instances } = fixture();
    await service.startSmartSpectraSession({ source: 'custom' });
    instances[0].sendFrame = () => true;
    const rgba = Buffer.alloc(2 * 1 * 4);
    assert.equal(service.sendCustomFrame({ width: 2, height: 1, timestampUs: 1000, rgba }).accepted, true);
    assert.throws(() => service.sendCustomFrame({
        width: 2,
        height: 3,
        timestampUs: 2000,
        rgba: Buffer.alloc(2 * 3 * 4),
    }), /Camera aspect changed from 2x1 to 2x3/);
});
