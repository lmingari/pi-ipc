export type Message =
  | { type: "register"; clientName: string }
  | { type: "sum"; a: number; b: number; clientName: string }
  | { type: "log"; message: string; clientName: string };
