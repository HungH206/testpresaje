import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.status(200).json({
        queued: false,
        hostedMode: true,
        message: 'SmartSpectra LLM Insights require a persistent Express server with an active SDK session.',
    });
}
