import { randomUUID } from "node:crypto";

const HEADER = "x-correlation-id";

/**
 * Assigns req.correlationId, sets X-Correlation-ID on response.
 * Log prefix: [tl:api-gateway:<id>]
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
  const tag = req?.logTag ?? "api-gateway";
  return `[tl:${tag}:${id}] ${phase}`;
}

export function tlLog(req, phase, detail = {}) {
  const safe = { ...detail };
  if (safe.password != null) safe.password = "[redacted]";
  if (Object.keys(safe).length) console.log(prefix(req, phase), safe);
  else console.log(prefix(req, phase));
}

export function tlError(req, phase, err, detail = {}) {
  const msg = err?.message ?? String(err);
  console.error(prefix(req, `${phase} → ${msg}`), detail);
}
