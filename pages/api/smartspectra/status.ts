import type { NextApiRequest, NextApiResponse } from 'next';

const { getSdkStatus } = require('../../../services/smartspectra');

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.status(200).json(getSdkStatus());
}
