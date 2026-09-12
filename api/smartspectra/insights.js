'use strict';

module.exports = function smartspectraInsightsHandler(_req, res) {
    res.status(501).json({
        error: 'SmartSpectra LLM Insights require a long-lived Node.js SDK session. Use the Express server routes for session-backed insights.',
    });
};
