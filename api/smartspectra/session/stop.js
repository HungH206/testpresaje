'use strict';

module.exports = function smartspectraSessionStopHandler(_req, res) {
    res.status(200).json({
        sessionActive: false,
        message: 'No persistent SmartSpectra session is running in Vercel serverless.',
    });
};
