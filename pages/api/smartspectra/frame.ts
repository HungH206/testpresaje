import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.status(200).json({
        accepted: false,
        hostedMode: true,
        message: 'Frame streaming is disabled on hosted iPhone test deployments.',
    });
}
