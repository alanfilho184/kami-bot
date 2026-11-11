import express from 'express';
import bodyParser from './body-parser.middleware';
import requestContext from './request-context.middleware';
import verifySignature from './verify-signature.middleware';

const middlewares = express.Router();

middlewares.use(requestContext);
middlewares.use(bodyParser);
middlewares.use(verifySignature);

export default middlewares;
