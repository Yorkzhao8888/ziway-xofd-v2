import { Router } from 'express';
import healthRouter from './health';
import authRouter from './auth';

const router = Router();

router.use(healthRouter);
router.use(authRouter);

export default router;
