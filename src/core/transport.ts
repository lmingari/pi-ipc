export interface Transport {
  connect(): Promise<void>;

  // Client → server
  send(data: unknown): Promise<void>;

  // Server → one client
  sendTo(clientId: string, data: unknown): Promise<void>;

  // Server → all clients
  broadcast(data: unknown): Promise<void>;

  onMessage(cb: (data: unknown, clientId?: string) => void): void;

  onDisconnect(cb: (clientId?: string) => void): void;

  close(): Promise<void>;
}
