import { Router, Request, Response } from 'express';
import db from '../configs/database';
import config from '../configs/config';

const router = Router();

router.get('/ping', (req: Request, res: Response) => {
    res.status(200).json({ pong: true, timestamp: Date.now() });
});

router.get('/status', async (req: Request, res: Response) => {
    try {
        let dbStatus: { ok: boolean }[] = await db.$queryRaw`SELECT true as ok`;

        if (dbStatus[0].ok === true) {
            res.status(200).json({
                instance_type: config.INSTANCE_TYPE,
                status: 'healthy',
                db: 'ok',
                timestamp: Date.now()
            });
        } else {
            res.status(503).json({
                instance_type: config.INSTANCE_TYPE,
                status: 'unhealthy',
                db: 'failed',

                timestamp: Date.now()
            });
        }
    } catch (err) {
        res.status(503).json({
            instance_type: config.INSTANCE_TYPE,
            status: 'unhealthy',
            db: 'failed',
            timestamp: Date.now()
        });
    }
});

export default router;
