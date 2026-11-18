/* eslint-env node */
import { authenticate } from "../shopify.server";
import { createUpgradeCharge } from "../billing.server";

/**
 * Route: /app/upgrade
 * Initiates the Shopify recurring application charge for Pro plan ("The Elevate")
 * and returns or redirects to Shopify's "Approve charge" screen.
 */
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const confirmationUrl = await createUpgradeCharge(admin, session);
    return Response.json({ confirmationUrl });
  } catch (err) {
    console.error("[UPGRADE ACTION] Failed to create charge:", err);
    return Response.json(
      { error: err?.message || "Failed to initiate upgrade" },
      { status: 500 }
    );
  }
};

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    const confirmationUrl = await createUpgradeCharge(admin, session);
    if (request.headers.get("accept")?.includes("application/json")) {
      return Response.json({ confirmationUrl });
    }
    return new Response(
      `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Redirecting to Shopify Billing...</title>
          <script>
            if (window.top) {
              window.top.location.href = ${JSON.stringify(confirmationUrl)};
            } else {
              window.location.href = ${JSON.stringify(confirmationUrl)};
            }
          </script>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f6f6f7;">
          <p>Redirecting to Shopify Billing...</p>
        </body>
      </html>`,
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }
    );
  } catch (err) {
    console.error("[UPGRADE LOADER] Failed to create charge:", err);
    return Response.json(
      { error: err?.message || "Failed to initiate upgrade" },
      { status: 500 }
    );
  }
};

export default function Upgrade() {
  return null;
}
