export type Message =
  | { type: "sum"; a: number; b: number; clientName: string }
  | { type: "log"; message: string; clientName: string };
