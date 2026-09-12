'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { orientFrame } = require('../services/video-frame');
const { tokenHandler } = require('../services/livekit-config');
const { TokenVerifier } = require('livekit-server-sdk');

test('RGBA rotation preserves pixels and portrait dimensions', () => {
    const data = Buffer.from([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255,
        4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255]);
    const expected = [[1, 2, 3, 4, 5, 6], [4, 1, 5, 2, 6, 3],
        [6, 5, 4, 3, 2, 1], [3, 6, 2, 5, 1, 4]];
    for (let rotation = 0; rotation < 4; rotation++) {
        const output = orientFrame({ width: 3, height: 2, data }, rotation);
        assert.equal(output.width, rotation % 2 ? 2 : 3);
        assert.equal(output.height, rotation % 2 ? 3 : 2);
        assert.deepEqual([...output.rgba].filter((_, index) => index % 4 === 0), expected[rotation]);
    }
});

test('token endpoint authenticates and restricts browser roles', async () => {
    const variables = { LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'test-key',
        LIVEKIT_API_SECRET: 'test-secret-not-a-real-credential', LIVEKIT_ACCESS_CODE: 'test-code', LIVEKIT_ROOM: 'test-room' };
    const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
    Object.assign(process.env, variables);
    async function request(body) {
        const res = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
        await tokenHandler({ method: 'POST', body }, res);
        return res;
    }
    try {
        assert.equal((await request({ role: 'publisher', accessCode: 'wrong' })).code, 401);
        assert.equal((await request({ role: 'worker', accessCode: 'test-code' })).code, 400);
        assert.equal((await request({ role: 'native', accessCode: 'test-code' })).code, 400);
        for (const role of ['publisher', 'dashboard']) {
            const response = await request({ role, accessCode: 'test-code' });
            const claims = await new TokenVerifier(variables.LIVEKIT_API_KEY, variables.LIVEKIT_API_SECRET).verify(response.body.token);
            assert.equal(claims.video.room, 'test-room');
            assert.equal(claims.video.canPublish, role === 'publisher');
            assert.notEqual(claims.sub, 'processor');
            assert.equal(Object.hasOwn(response.body, 'secret'), false);
        }
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});

test('only a sustained real-time stream passes camera warmup', () => {
    const { FrameCadence } = require('../services/frame-cadence');
    for (const fps of [15, 20, 30]) {
        const cadence = new FrameCadence();
        for (let i = 0; i < fps * 2; i++) cadence.add(1000000 + Math.round(i * 1000000 / fps), i * 1000 / fps);
        assert.equal(cadence.ready, fps >= 25);
        assert.equal(cadence.add(1000000, 3000), false);
    }
    const burst = new FrameCadence();
    for (let i = 0; i < 60; i++) burst.add(1000000 + i * 33333, i);
    assert.equal(burst.ready, false);
});

test('sparse metrics persist between updates but stale readings expire', () => {
    const { MetricsCache } = require('../services/metrics-cache');
    const cache = new MetricsCache();
    cache.update({ pulseRate: 72, pulseConfidence: 80, breathingRate: 15, blinking: false }, 1000);
    cache.update({ pulseRate: null, blinking: true }, 2000);
    assert.equal(cache.snapshot(2500).pulseRate, 72);
    assert.equal(cache.snapshot(2500).blinking, true);
    assert.equal(cache.snapshot(6000).blinking, undefined);
    assert.equal(cache.snapshot(17000).pulseRate, undefined);
    assert.equal(cache.snapshot(17000).breathingRate, 15);
    cache.clear();
    assert.deepEqual(cache.snapshot(18000), {});
});
