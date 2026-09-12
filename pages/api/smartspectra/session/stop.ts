import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.status(200).json({
        sessionActive: false,
        message: 'No persistent SmartSpectra session is running in Vercel serverless.',
    });
}
