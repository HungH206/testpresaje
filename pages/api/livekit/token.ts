import type { NextApiRequest, NextApiResponse } from 'next';

const { tokenHandler } = require('../../../services/livekit-config');

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    return tokenHandler(req, res);
}
