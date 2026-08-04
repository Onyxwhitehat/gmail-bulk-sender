import { Router } from 'express';
import { authRouter } from './auth.js';
import { campaignsRouter } from './campaigns.js';
import { googleRouter } from './google.js';
import { logsRouter } from './logs.js';
import { recipientsRouter } from './recipients.js';
import { settingsRouter } from './settings.js';
import { sheetsRouter } from './sheets.js';
import { statsRouter } from './stats.js';
import { streamRouter } from './stream.js';
import { templatesRouter } from './templates.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/google', googleRouter);
apiRouter.use('/sheets', sheetsRouter);
apiRouter.use('/recipients', recipientsRouter);
apiRouter.use('/campaigns', campaignsRouter);
apiRouter.use('/logs', logsRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/templates', templatesRouter);
apiRouter.use('/stream', streamRouter);
