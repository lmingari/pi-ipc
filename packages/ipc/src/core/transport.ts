export interface Transport {
  connect(): Promise<void>;

  write(data: unknown, clientId?: string): Promise<void>;

  onMessage(cb: (data: unknown, clientId?: string) => void): void;

  onDisconnect(cb: (clientId?: string) => void): void;

  close(): Promise<void>;
}
