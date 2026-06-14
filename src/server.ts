import "./lib/error-capture";

import process from "node:process";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const LOVABLE_ASSET_ORIGIN = "https://den-mond-anstreben.lovable.app";

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isLovableHostedAssetRequest(url: URL): boolean {
  return url.pathname.startsWith("/__l5e/assets-v1/");
}

async function fetchLovableHostedAsset(url: URL): Promise<Response> {
  const assetUrl = new URL(url.pathname + url.search, LOVABLE_ASSET_ORIGIN);
  const response = await fetch(assetUrl);

  if (!response.ok) return response;

  const headers = new Headers(response.headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bindRuntimeEnv(env: unknown): void {
  if (!env || typeof env !== "object") return;

  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string") process.env[key] = value;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      bindRuntimeEnv(env);
      const url = new URL(request.url);
      if (isLovableHostedAssetRequest(url) && !url.hostname.endsWith("lovable.app")) {
        return await fetchLovableHostedAsset(url);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
