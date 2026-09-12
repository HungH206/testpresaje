'use strict';

module.exports = function smartspectraFrameHandler(_req, res) {
    res.status(501).json({
        error: 'Browser frame streaming requires the long-lived Express server. Vercel serverless cannot hold the native SmartSpectra session.',
    });
};
