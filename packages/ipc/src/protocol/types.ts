export type Message =
  | { type: "register"; clientName: string }
  | { type: "sum"; a: number; b: number }
  | { type: "log"; message: string };
