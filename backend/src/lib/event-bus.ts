import type { Response } from "express";
import { logger } from "./logger.js";

export interface BrainEvent {
  event:     string;
  data:      Record<string, unknown>;
  timestamp: string;
  trace_id:  string;
}

class EventBus {
  private clients = new Map<string, Response>();
  private lastEvents: BrainEvent[] = [];
  private readonly MAX_HISTORY = 50;

  register(id: string, res: Response): void {
    this.clients.set(id, res);
    logger.info({ clientId: id, total: this.clients.size }, "SSE client connected");

    // Replay last event so new subscriber is instantly caught up
    const last = this.lastEvents[this.lastEvents.length - 1];
    if (last) {
      this.sendToClient(res, last.event, last.data, last.trace_id);
    }
  }

  unregister(id: string): void {
    this.clients.delete(id);
    logger.info({ clientId: id, total: this.clients.size }, "SSE client disconnected");
  }

  broadcast(event: string, data: Record<string, unknown>, traceId: string): void {
    const payload: BrainEvent = {
      event,
      data,
      timestamp: new Date().toISOString(),
      trace_id:  traceId,
    };

    this.lastEvents.push(payload);
    if (this.lastEvents.length > this.MAX_HISTORY) this.lastEvents.shift();

    let sent = 0;
    for (const [id, res] of this.clients) {
      try {
        this.sendToClient(res, event, data, traceId);
        sent++;
      } catch {
        this.clients.delete(id);
      }
    }

    logger.info({ event, clientsReached: sent, totalClients: this.clients.size }, "Event broadcast");
  }

  heartbeat(): void {
    const now = new Date().toISOString();
    for (const [id, res] of this.clients) {
      try {
        res.write(`: heartbeat ${now}\n\n`);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  get connectedCount(): number {
    return this.clients.size;
  }

  get recentEvents(): BrainEvent[] {
    return [...this.lastEvents].reverse();
  }

  private sendToClient(
    res: Response,
    event: string,
    data: Record<string, unknown>,
    traceId: string
  ): void {
    res.write(`id: ${traceId}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify({ ...data, trace_id: traceId, timestamp: new Date().toISOString() })}\n\n`);
  }
}

export const eventBus = new EventBus();

setInterval(() => {
  eventBus.heartbeat();
}, 15_000);
