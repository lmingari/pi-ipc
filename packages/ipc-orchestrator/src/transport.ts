import type { Envelope } from "./types.js";

export type MessageHandler = (message: Envelope, source?: string) => Promise<void> | void;

export interface Transport {
  send(target: string | null, message: Envelope): Promise<void>;
  onMessage(handler: MessageHandler): void;
  close?(): Promise<void>;
}
