import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const appUrl =
  process.env.SHOPIFY_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "");

// Shopify's Prisma storage checks the database once, when a server instance starts, and keeps
// a failed check for that instance's whole life. On Vercel, one network blip at start-up made
// every request on a warm instance fail with "session table does not exist" until a redeploy.
// Checking again after a failure limits a blip to the requests made during it.
class SessionStorage extends PrismaSessionStorage {
  constructor(...args) {
    super(...args);
    this.ready.catch(() => {}); // a failed start-up check is retried below, not an unhandled error
  }

  async ensureReady() {
    if (!(await this.ready.catch(() => false))) await this.isReady();
    return super.ensureReady();
  }
}

const INSTALL_WEBHOOK_URL = "https://hook.us2.make.com/dnccut3zbkuttmef8ak5587ra6q9exqb";
// ponytail: per server instance, so a shop costs one Admin API query per server start, not per page load.
const installChecked = new Set();

// Tells the Make scenario (which emails the merchant) about a new install, once per installation.
// Called from afterAuth and from the admin layout loader (routes/app.jsx), so it doesn't depend on
// a token exchange happening. The "already sent" marker is an app-data metafield on the app
// installation, holding the installation's id: a reinstall is a new installation without it, even
// when the app/uninstalled webhook never arrived. No database needed.
// Logs each step; never throws, because an afterAuth error would fail the merchant's install.
export async function notifyInstall(admin, shop) {
  if (installChecked.has(shop)) return;
  installChecked.add(shop);
  try {
    console.log(`[INSTALL] ${shop}: step 1/3 checking whether this installation was sent to Make`);
    const response = await admin.graphql(
      `#graphql
      query InstallShopInfo {
        currentAppInstallation {
          id
          notified: metafield(namespace: "$app", key: "install_notified") { value }
        }
        shop {
          id name email contactEmail myshopifyDomain shopOwnerName createdAt
          primaryDomain { host }
          plan { publicDisplayName }
          shopAddress { country phone }
        }
      }`,
    );
    const { data, errors } = await response.json();
    const installation = data?.currentAppInstallation;
    const s = data?.shop;
    if (!installation || !s) throw new Error(`no shop info from Shopify: ${JSON.stringify(errors)}`);
    if (installation.notified?.value === installation.id) {
      console.log(`[INSTALL] ${shop}: already sent to Make for this installation. Nothing to do.`);
      return;
    }
    console.log(`[INSTALL] ${shop}: step 1/3 OK, new install (${s.name}, ${s.email})`);

    const payload = {
      app_name: "Countless Options",
      event: "App Installed",
      shop_id: s.id.split("/").pop(),
      shop_name: s.name,
      shop_email: s.email,
      shop_phone: s.shopAddress?.phone || "Not provided",
      shop_domain: s.myshopifyDomain,
      domain: s.primaryDomain?.host,
      plan_name: s.plan?.publicDisplayName,
      country: s.shopAddress?.country,
      shop_owner: s.shopOwnerName,
      customer_email: s.contactEmail,
      created_at: new Date(s.createdAt).toLocaleString("en-US", {
        timeZone: "UTC",
        dateStyle: "long",
        timeStyle: "medium",
      }),
      // Same fields as the other apps' installs, in case the Make scenario maps them.
      credits_before: "0",
      credits_purchased: "N/A",
      credits_after: "0",
      purchase_name: "N/A",
      purchase_status: "N/A",
    };

    console.log(`[INSTALL] ${shop}: step 2/3 sending to Make`, payload);
    const res = await fetch(INSTALL_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), // a slow Make can't hold up the page
    });
    const answer = await res.text();
    if (!res.ok) throw new Error(`Make answered ${res.status} "${answer}"`);
    console.log(`[INSTALL] ${shop}: step 2/3 OK, Make answered ${res.status} "${answer}"`);

    // ponytail: if this step fails after Make got the data, the next try sends it to Make again.
    const marked = await admin.graphql(
      `#graphql
      mutation MarkInstallNotified($ownerId: ID!, $value: String!) {
        metafieldsSet(metafields: [{ ownerId: $ownerId, namespace: "$app", key: "install_notified", type: "single_line_text_field", value: $value }]) {
          userErrors { field message }
        }
      }`,
      { variables: { ownerId: installation.id, value: installation.id } },
    );
    const userErrors = (await marked.json()).data?.metafieldsSet?.userErrors;
    if (userErrors?.length) throw new Error(`could not save the "sent" marker: ${JSON.stringify(userErrors)}`);
    console.log(`[INSTALL] ${shop}: step 3/3 OK, marked as sent. Done.`);
  } catch (error) {
    installChecked.delete(shop); // try again on the next admin page load
    console.error(`[INSTALL] ${shop}: FAILED, will try again on the next admin page load:`, error);
  }
}


const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl,
  authPathPrefix: "/auth",
  sessionStorage: new SessionStorage(prisma),
  distribution: AppDistribution.AppStore,


  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: ({ admin, session }) => notifyInstall(admin, session.shop),
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
