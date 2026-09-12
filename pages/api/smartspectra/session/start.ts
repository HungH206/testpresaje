import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
    res.status(200).json({
        sessionActive: false,
        hostedMode: true,
        nativeSessionEnabled: false,
        message: 'Hosted iPhone test mode uses browser camera quality only.',
    });
}
