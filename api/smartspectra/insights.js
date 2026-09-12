'use strict';

module.exports = function smartspectraInsightsHandler(_req, res) {
    res.status(200).json({
        queued: false,
        hostedMode: true,
        message: 'SmartSpectra LLM Insights require a persistent Express server with an active SDK session.',
    });
};
