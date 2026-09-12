'use strict';

module.exports = function smartspectraSessionStartHandler(_req, res) {
    res.status(200).json({
        sessionActive: false,
        hostedMode: true,
        nativeSessionEnabled: false,
        message: 'Hosted iPhone test mode uses browser camera quality only.',
    });
};
