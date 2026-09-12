'use strict';

const { timingSafeEqual, randomUUID } = require('node:crypto');
const { AccessToken } = require('livekit-server-sdk');

function config() {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret,
        LIVEKIT_ACCESS_CODE: accessCode, LIVEKIT_REQUIRE_ACCESS_CODE: requireAccessCode,
        LIVEKIT_ROOM: room = 'vitalscan-test' } = process.env;
    const required = { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret };
    const missing = Object.entries(required)
        .filter(([, value]) => !value?.trim())
        .map(([name]) => name);
    if (missing.length) throw new Error(`Missing LiveKit environment variables: ${missing.join(', ')}`);
    return { url, key, secret, accessCode: accessCode || '',
        requireAccessCode: requireAccessCode === '1', room };
}

async function tokenFor(role) {
    const { url, key, secret, room } = config();
    const identity = role === 'worker' ? 'processor' : `${role}-${randomUUID()}`;
    const token = new AccessToken(key, secret, { identity, ttl: '15m' });
    token.addGrant({ roomJoin: true, room, canSubscribe: true,
        canPublish: role === 'publisher', canPublishData: true });
    return { url, token: await token.toJwt() };
}

async function tokenHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
    try {
        const { accessCode, requireAccessCode } = config();
        const supplied = String(req.body?.accessCode || '');
        const expected = String(accessCode || '');
        const codeRequired = requireAccessCode && expected.length > 0;
        const suppliedBuffer = Buffer.from(supplied);
        const expectedBuffer = Buffer.from(expected);
        if (codeRequired && (suppliedBuffer.length !== expectedBuffer.length
                || !timingSafeEqual(suppliedBuffer, expectedBuffer))) {
            return res.status(401).json({ error: 'Invalid test access code' });
        }
        const role = req.body?.role;
        if (!['publisher', 'dashboard'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
        res.json(await tokenFor(role));
    } catch {
        res.status(503).json({ error: 'LiveKit is not configured on this server.' });
    }
}

module.exports = { config, tokenFor, tokenHandler };
