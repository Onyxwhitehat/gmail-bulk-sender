import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { closeDatabase, migrate } from './db/index.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { attachUser, countUsers, createUser } from './middleware/auth.js';
import { ensureCsrfCookie, verifyCsrf } from './middleware/csrf.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { apiRouter } from './routes/index.js';
import { sender } from './services/sender.js';

const app = express();

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

// Behind nginx/Cloudflare, req.ip must come from X-Forwarded-For or every client
// shares one rate-limit bucket. Left unset by default because trusting the header
// blindly lets anyone spoof their IP.
if (config.trustProxy) {
  app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy);
}
app.disable('x-powered-by');

app.use(
  helmet({
    // The API serves JSON, not documents; CSP is applied by the Next.js frontend.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  }),
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin/server-to-server requests have no Origin header.
      if (!origin || origin === config.appUrl) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    maxAge: 86_400,
  }),
);

// Attachments arrive base64-encoded inside the JSON payload.
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Session + CSRF + rate limiting, applied to the whole API
// ---------------------------------------------------------------------------
app.use(attachUser);
app.use(ensureCsrfCookie);
app.use('/api', apiLimiter);
app.use('/api', verifyCsrf);
app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  migrate();
  sender.recoverOnBoot();

  // Optional: create the first admin from env vars for unattended deployments.
  if (config.bootstrapAdminEmail && config.bootstrapAdminPassword && countUsers() === 0) {
    await createUser(config.bootstrapAdminEmail, config.bootstrapAdminPassword, 'Administrator');
    logger.info(`created bootstrap admin account for ${config.bootstrapAdminEmail}`);
  }

  const server = app.listen(config.port, config.host, () => {
    logger.info(`API listening on http://${config.host}:${config.port} (${config.env})`);
    logger.info(`dashboard origin: ${config.appUrl}`);
    if (countUsers() === 0) {
      logger.warn('no admin account exists yet — open the dashboard to complete first-time setup');
    }
  });

  // SSE connections are long-lived by design; do not let Node time them out.
  server.headersTimeout = 0;
  server.requestTimeout = 0;

  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
    // Force-exit if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((error) => {
  logger.error('failed to start server', error);
  process.exit(1);
});

export { app };
