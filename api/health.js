const { hasConfiguredApiKey } = require('../app');

module.exports = function healthHandler(_req, res) {
    res.status(200).json({
        ok: true,
        app: 'VitalScan',
        hasApiKey: hasConfiguredApiKey(),
    });
};
