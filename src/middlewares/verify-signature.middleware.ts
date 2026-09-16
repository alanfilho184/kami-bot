import { Request, Response, NextFunction } from 'express';
import config from '../configs/config';
import nacl from 'tweetnacl';
import logger from '../configs/logger';

export default function verifySignature(req: Request, res: Response, next: NextFunction) {
    if (`${req.method}|${req.baseUrl}${req.path}` == 'POST|/interactions') {
        const signature = req.get('x-signature-ed25519')!;
        const timestamp = req.get('x-signature-timestamp')!;

        let isVerified = false;
        try {
            isVerified = nacl.sign.detached.verify(
                Buffer.from(timestamp + req.rawBody),
                Buffer.from(signature, 'hex'),
                Buffer.from(config.PUBLIC_KEY, 'hex')
            );
        } catch (err) {
            return res.status(401).send({ error: 'Bad request signature' });
        }

        if (!isVerified) {
            return res.status(401).send({ error: 'Bad request signature' });
        } else {
            next();
        }
    } else {
        if (req.headers.authorization) {
            if (req.headers.authorization === config.API_TOKEN) {
                next();
            } else {
                res.status(403).end();
            }
        } else {
            res.status(403).end();
        }
    }
}
