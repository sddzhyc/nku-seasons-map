import { setTimeout as delay } from "node:timers/promises";
import { convertOsm, ENDPOINTS, overpassUrl } from "../src/data.js";

export interface OsmAttempt {
  endpoint: string;
  round: number;
  outcome: "success" | "failed" | "deferred";
  status?: number;
  elapsedMs: number;
  message?: string;
}
interface Options {
  timeoutMs: number;
  endpoints?: readonly string[];
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  report?: (attempt: OsmAttempt) => void;
}
const BACKOFF_MS = 30_000;
const MAX_WAIT_MS = 60_000;

function retryDelay(value: string | null, now: number): number {
  if (!value) return BACKOFF_MS;
  const millis = /^\d+$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(millis) ? Math.max(BACKOFF_MS, millis) : BACKOFF_MS;
}
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (
    error as Error & { cause?: { code?: string; message?: string } }
  ).cause;
  return [error.name, error.message, cause?.code, cause?.message]
    .filter(Boolean)
    .join(": ");
}

// Two sequential rounds, with a per-server cooldown. A long Retry-After defers
// that server to a later scheduled run rather than retrying before its limit.
export async function queryOverpass(
  query: string,
  options: Options,
): Promise<{ raw: unknown; source: string }> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? delay;
  const now = options.now ?? Date.now;
  const report = options.report ?? (() => {});
  const servers = (options.endpoints ?? ENDPOINTS).map((endpoint) => ({
    endpoint,
    retryAt: 0,
    eligible: true,
  }));
  const failures: string[] = [];
  for (let round = 1; round <= 2; round++) {
    for (const server of servers) {
      if (!server.eligible) continue;
      const waitMs = Math.max(0, server.retryAt - now());
      if (waitMs > MAX_WAIT_MS) {
        report({
          endpoint: server.endpoint,
          round,
          outcome: "deferred",
          elapsedMs: 0,
          message: `Retry-After 尚需 ${Math.ceil(waitMs / 1000)} 秒，本轮不重试`,
        });
        continue;
      }
      if (waitMs) await sleep(waitMs);
      const start = now();
      let status: number | undefined;
      let retryable = true;
      let cooldown = BACKOFF_MS;
      try {
        const response = await fetcher(overpassUrl(server.endpoint, query), {
          headers: {
            "User-Agent":
              "NkuSeasonsMap/0.4 (https://sddzhyc.github.io/nku-seasons-map/)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        status = response.status;
        if (!response.ok) {
          retryable = [406, 408, 429].includes(status) || status >= 500;
          cooldown = retryDelay(response.headers.get("retry-after"), now());
          const body = (await response.text())
            .replace(/<[^>]*>/g, " ")
            .replace(/[\u0000-\u001f\u007f]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300);
          throw Error(
            `HTTP ${status}; content-type=${response.headers.get("content-type") ?? "unknown"}; server=${response.headers.get("server") ?? "unknown"}; ${body}`,
          );
        }
        const raw = await response.json();
        // A 200 response with an Overpass error/partial payload is not success.
        convertOsm(raw, server.endpoint);
        report({
          endpoint: server.endpoint,
          round,
          outcome: "success",
          status,
          elapsedMs: now() - start,
        });
        return { raw, source: server.endpoint };
      } catch (error) {
        const message = errorText(error);
        failures.push(`${server.endpoint} round=${round}: ${message}`);
        report({
          endpoint: server.endpoint,
          round,
          outcome: "failed",
          status,
          elapsedMs: now() - start,
          message,
        });
        server.eligible = retryable;
        server.retryAt = now() + cooldown;
      }
    }
  }
  throw Error(
    "两轮 Overpass 查询均失败，保留已有有效数据。\n" + failures.join("\n"),
  );
}
