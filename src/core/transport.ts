export interface Transport {
  connect(): Promise<void>;
  send(data: unknown): Promise<void>;
  onMessage(cb: (data: unknown) => void): void;
  onDisconnect(cb: () => void): void;
  close(): Promise<void>;
}
