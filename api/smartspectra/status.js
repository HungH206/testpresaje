'use strict';

const { getSdkStatus } = require('../../services/smartspectra');

module.exports = function smartspectraStatusHandler(_req, res) {
    res.status(200).json(getSdkStatus());
};
