import type { NextApiRequest, NextApiResponse } from 'next';

const { hasConfiguredApiKey } = require('../../services/smartspectra');

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.status(200).json({
        ok: true,
        app: 'VitalScan',
        hasApiKey: hasConfiguredApiKey(),
    });
}
