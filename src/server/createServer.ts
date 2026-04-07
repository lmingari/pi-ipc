import { createTransport } from "../core/createTransport";
import { isMessage } from "../protocol/guards";

export type ServerCallbacks = {
  onMessage: (msg: unknown) => void;
  onInvalidMessage?: (msg: unknown) => void;
  onDisconnect?: () => void;
};

export async function createServer(callbacks: ServerCallbacks) {
  const transport = createTransport("server");

  await transport.connect();

  transport.onMessage((raw) => {
    if (!isMessage(raw)) {
      callbacks.onInvalidMessage?.(raw);
      return;
    }

    callbacks.onMessage(raw);
  });

  transport.onDisconnect(() => {
    callbacks.onDisconnect?.();
  });

  return {
    close: () => transport.close(),
  };
}
