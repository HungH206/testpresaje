'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname, {
    extensions: ['html'],
    setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
    },
}));

app.get('/health', (_req, res) => {
    res.json({
        ok: true,
        app: 'VitalScan',
        hasApiKey: Boolean(process.env.VITALSCAN_API_KEY && process.env.VITALSCAN_API_KEY !== 'replace_with_your_test_key'),
    });
});

app.use((_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(port, host, () => {
    console.log(`VitalScan running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
    console.log('Phone camera testing requires HTTPS. Deploy it or expose it with an HTTPS tunnel.');
});

server.on('error', (error) => {
    console.error(`Unable to start VitalScan on ${host}:${port}`);
    console.error(error.message);
    process.exitCode = 1;
});
