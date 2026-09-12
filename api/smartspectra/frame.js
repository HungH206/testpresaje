'use strict';

module.exports = function smartspectraFrameHandler(_req, res) {
    res.status(200).json({
        accepted: false,
        hostedMode: true,
        message: 'Frame streaming is disabled on hosted iPhone test deployments.',
    });
};
