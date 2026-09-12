'use strict';

const { timingSafeEqual, randomUUID } = require('node:crypto');
const { AccessToken, LiveKitAPI } = require('livekit-server-sdk');

function config() {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret,
        LIVEKIT_ACCESS_CODE: accessCode, LIVEKIT_ROOM: room = 'vitalscan-test',
        LIVEKIT_AGENT_NAME: agentName = '' } = process.env;
    const required = { LIVEKIT_URL: url, LIVEKIT_API_KEY: key,
        LIVEKIT_API_SECRET: secret, LIVEKIT_ACCESS_CODE: accessCode };
    const missing = Object.entries(required)
        .filter(([, value]) => !value?.trim())
        .map(([name]) => name);
    if (missing.length) throw new Error(`Missing LiveKit environment variables: ${missing.join(', ')}`);
    return { url, key, secret, accessCode, room, agentName };
}

function apiHost(url) {
    return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

async function ensureAgentDispatch(room, metadata = {}) {
    const { url, key, secret, agentName } = config();
    if (!agentName.trim()) return null;
    const api = new LiveKitAPI(apiHost(url), key, secret);
    try {
        const dispatches = await api.agentDispatch.listDispatch(room);
        const existing = dispatches.find(dispatch => dispatch.agentName === agentName);
        if (existing) return existing;
    } catch {
        // The room might not exist yet. createDispatch creates it when needed.
    }
    return api.agentDispatch.createDispatch(room, agentName, {
        metadata: JSON.stringify(metadata),
    });
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
        const { accessCode } = config();
        const supplied = Buffer.from(String(req.body?.accessCode || ''));
        const expected = Buffer.from(accessCode);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
            return res.status(401).json({ error: 'Invalid test access code' });
        }
        const role = req.body?.role;
        if (!['publisher', 'dashboard'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
        await ensureAgentDispatch(config().room, { role, requestedAt: new Date().toISOString() });
        res.json(await tokenFor(role));
    } catch {
        res.status(503).json({ error: 'LiveKit is not configured on this server.' });
    }
}

module.exports = { config, ensureAgentDispatch, tokenFor, tokenHandler };
