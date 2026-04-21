import { randomUUID } from "node:crypto";

const HEADER = "x-correlation-id";

/**
 * Assigns req.correlationId (from X-Correlation-ID or new UUID), sets response header.
 * Log prefix: [tl:keycloak-api:<id>]
 */
export function correlationMiddleware(serviceTag) {
  return (req, res, next) => {
    const incoming = req.get(HEADER) || req.get("x-request-id");
    const id =
      typeof incoming === "string" && incoming.trim().length > 0
        ? incoming.trim().slice(0, 128)
        : randomUUID();
    req.correlationId = id;
    req.logTag = serviceTag;
    res.setHeader("X-Correlation-ID", id);
    next();
  };
}

function prefix(req, phase) {
  const id = req?.correlationId ?? "unknown";
  const tag = req?.logTag ?? "keycloak-api";
  return `[tl:${tag}:${id}] ${phase}`;
}

export function tlLog(req, phase, detail = {}) {
  const safe = { ...detail };
  if (safe.password != null) safe.password = "[redacted]";
  const line = prefix(req, phase);
  if (Object.keys(safe).length) console.log(line, safe);
  else console.log(line);
}

export function tlWarn(req, phase, detail = {}) {
  const safe = { ...detail };
  if (safe.password != null) safe.password = "[redacted]";
  console.warn(prefix(req, phase), safe);
}

export function tlError(req, phase, err, detail = {}) {
  const msg = err?.message ?? String(err);
  const extra = { ...detail };
  if (err?.payload != null) extra.auth0Payload = err.payload;
  if (err?.status != null) extra.httpStatus = err.status;
  console.error(prefix(req, `${phase} → ${msg}`), extra);
}

/** Logs without Express req (e.g. auth provider helpers). */
export function tlSpan(servicePart, correlationId, phase, detail = {}) {
  const id = correlationId || "unknown";
  const safe = { ...detail };
  if (safe.password != null) safe.password = "[redacted]";
  const line = `[tl:${servicePart}:${id}] ${phase}`;
  if (Object.keys(safe).length) console.log(line, safe);
  else console.log(line);
}
