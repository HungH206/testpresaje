'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

const publicDir = path.join(__dirname, 'public');

function hasConfiguredApiKey() {
    return Boolean(
        process.env.VITALSCAN_API_KEY &&
        process.env.VITALSCAN_API_KEY !== 'replace_with_your_test_key',
    );
}

function createApp() {
    const app = express();

    app.use(cors());
    app.use(express.json());
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

    app.use((_req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
module.exports.hasConfiguredApiKey = hasConfiguredApiKey;
