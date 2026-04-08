// core/createTransport.ts
import { Transport } from "./transport.js";
import { UnixSocketTransport } from "../transports/unixSocket.js";

export function createTransport(
  role: "server" | "client"
): Transport {
  return new UnixSocketTransport("/tmp/generic.sock", role);
}
