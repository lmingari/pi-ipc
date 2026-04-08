import { Message } from "./types.js";

export function isMessage(msg: any): msg is Message {
  if (typeof msg !== "object" || msg === null) return false;

  switch (msg.type) {
    case "register":
      return typeof msg.clientName === "string";

    case "sum":
      return (
        typeof msg.a === "number" &&
        typeof msg.b === "number"
      );

    case "log":
      return (
        typeof msg.message === "string"
      );

    default:
      return false;
  }
}
