import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { events } from '../services/events.js';
import { sender } from '../services/sender.js';

export const streamRouter = Router();

/**
 * Server-Sent Events feed for live progress.
 *
 * SSE over WebSockets here because the traffic is one-directional (server to
 * dashboard), it survives reverse proxies with no extra configuration, and the
 * browser reconnects automatically after a drop.
 */
streamRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Tells nginx not to buffer the stream, which would defeat the point.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    events.addClient(res);

    // Send the current state immediately so a freshly-opened tab is never blank.
    res.write(`event: progress\ndata: ${JSON.stringify(sender.status())}\n\n`);
    res.write(`retry: 3000\n\n`);

    req.on('close', () => res.end());
  }),
);
