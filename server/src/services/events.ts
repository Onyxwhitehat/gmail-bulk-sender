import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { logger } from '../lib/logger.js';

export type AppEvent =
  | { type: 'progress'; payload: unknown }
  | { type: 'log'; payload: unknown }
  | { type: 'status'; payload: unknown }
  | { type: 'account'; payload: unknown };

class EventHub extends EventEmitter {
  private clients = new Set<Response>();

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /** Registers an SSE client and keeps it alive until it disconnects. */
  addClient(res: Response): void {
    this.clients.add(res);
    logger.debug(`SSE client connected (${this.clients.size} total)`);

    res.on('close', () => {
      this.clients.delete(res);
      logger.debug(`SSE client disconnected (${this.clients.size} remaining)`);
    });
  }

  /** Pushes an event to every connected dashboard. */
  broadcast(event: AppEvent): void {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
    this.emit(event.type, event.payload);
  }

  /** SSE comment frame — keeps proxies from closing an idle connection. */
  heartbeat(): void {
    for (const client of this.clients) {
      try {
        client.write(`: ping ${Date.now()}\n\n`);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const events = new EventHub();

// Proxies (nginx, Cloudflare) drop connections with no traffic; 25s is comfortably
// inside the common 30-60s idle timeouts.
const heartbeatTimer = setInterval(() => events.heartbeat(), 25_000);
heartbeatTimer.unref();
