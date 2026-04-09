import type {
  EnvelopeMessage,
  LogMessage,
  Message,
  ProgressEnvelope,
  RegisterMessage,
  ReplyEnvelope,
  RequestEnvelope,
  StatusMessage,
} from "./types.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isRegisterMessage = (value: unknown): value is RegisterMessage => {
  if (!isObject(value)) return false;
  return value.type === "register" && typeof value.clientName === "string";
};

export const isLogMessage = (value: unknown): value is LogMessage => {
  if (!isObject(value)) return false;
  return value.type === "log" && typeof value.message === "string";
};

export const isStatusMessage = (value: unknown): value is StatusMessage => {
  if (!isObject(value)) return false;
  return (
    value.type === "status" &&
    (value.status === "idle" || value.status === "busy") &&
    (value.timestamp === undefined || typeof value.timestamp === "number")
  );
};

export const isEnvelopeMessage = (value: unknown): value is EnvelopeMessage => {
  if (!isObject(value)) return false;
  return (
    (value.type === "request" ||
      value.type === "reply" ||
      value.type === "progress" ||
      value.type === "cancel" ||
      value.type === "ack") &&
    value.v === 1 &&
    typeof value.from === "string" &&
    (value.to === undefined || typeof value.to === "string") &&
    (value.requestId === undefined || typeof value.requestId === "string") &&
    typeof value.timestamp === "number" &&
    Object.prototype.hasOwnProperty.call(value, "payload")
  );
};

export const isRequestEnvelope = (value: unknown): value is RequestEnvelope => {
  if (!isEnvelopeMessage(value)) return false;
  return value.type === "request" && typeof value.requestId === "string" && typeof value.to === "string";
};

export const isReplyEnvelope = (value: unknown): value is ReplyEnvelope => {
  if (!isEnvelopeMessage(value)) return false;
  return value.type === "reply" && typeof value.requestId === "string";
};

export const isProgressEnvelope = (value: unknown): value is ProgressEnvelope => {
  if (!isEnvelopeMessage(value)) return false;
  return value.type === "progress" && typeof value.requestId === "string";
};

export function isMessage(value: unknown): value is Message {
  return (
    isRegisterMessage(value) ||
    isLogMessage(value) ||
    isStatusMessage(value) ||
    isEnvelopeMessage(value)
  );
}
