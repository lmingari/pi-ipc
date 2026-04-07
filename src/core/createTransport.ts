// core/createTransport.ts
import { Transport } from "./transport";
import { UnixSocketTransport } from "../transports/unixSocket";

export function createTransport(
  role: "server" | "client"
): Transport {
  return new UnixSocketTransport("/tmp/generic.sock", role);
}
