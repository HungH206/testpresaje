'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const {
    getSdkStatus,
    hasConfiguredApiKey,
    requestInsight,
    sendCustomFrame,
    startSmartSpectraSession,
    stopSmartSpectraSession,
} = require('./services/smartspectra');

const publicDir = path.join(__dirname, 'public');

function createApp() {
    const app = express();

    app.use(cors());
    app.use(express.json({ limit: '12mb' }));
    app.post('/api/livekit/token', require('./services/livekit-config').tokenHandler);
    app.use(express.static(publicDir, {
        extensions: ['html'],
        setHeaders(res) {
            res.setHeader('X-Content-Type-Options', 'nosniff');
        },
    }));

    app.get('/health', (_req, res) => {
        res.json({
            ok: true,
            app: 'VitalScan',
            hasApiKey: hasConfiguredApiKey(),
        });
    });

    app.get('/api/smartspectra/status', (_req, res) => {
        res.json(getSdkStatus());
    });

    app.get('/smartspectra/status', (_req, res) => {
        res.json(getSdkStatus());
    });

    app.post('/api/smartspectra/session/start', async (req, res) => {
        try {
            res.json(await startSmartSpectraSession(req.body || {}));
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    });

    app.post('/api/smartspectra/session/stop', async (_req, res) => {
        try {
            res.json(await stopSmartSpectraSession());
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    });

    app.post('/api/smartspectra/insights', (req, res) => {
        try {
            res.json(requestInsight(req.body?.prompt));
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    });

    app.post('/api/smartspectra/frame', (req, res) => {
        try {
            res.json(sendCustomFrame(req.body || {}));
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    });

    app.use((_req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
module.exports.hasConfiguredApiKey = hasConfiguredApiKey;
