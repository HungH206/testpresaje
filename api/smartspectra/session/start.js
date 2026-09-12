'use strict';

module.exports = function smartspectraSessionStartHandler(_req, res) {
    res.status(501).json({
        error: 'Live SmartSpectra sessions need a persistent Express server. The iPhone Vercel build supports HTTPS camera UI testing only.',
    });
};
