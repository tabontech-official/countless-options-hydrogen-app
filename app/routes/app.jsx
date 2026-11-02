import { Outlet, redirect, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate, notifyInstall } from "../shopify.server";
import { repairPricing } from "../options.server";
import styles from "../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }) => {
  // Back from Shopify's approval page the app opens outside the admin: a shop but no host. App Bridge can't start
  // there, so send the merchant into the admin, which loads the app embedded.
  const { searchParams } = new URL(request.url);
  const shop = searchParams.get("shop");
  if (shop?.endsWith(".myshopify.com") && !searchParams.has("host")) {
    throw redirect(`https://admin.shopify.com/store/${shop.replace(".myshopify.com", "")}/apps/${process.env.SHOPIFY_API_KEY}/app`);
  }
  const { admin, session } = await authenticate.admin(request);
  // Recreates the pricing setup if it went missing (e.g. after a reinstall); never blocks the page.
  await repairPricing(admin, session.shop).catch((error) => console.error("repairPricing", error));
  // Sends a new install to Make (once per installation, checked once per server start); never throws.
  await notifyInstall(admin, session.shop);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shop: session.shop };
};

export default function App() {
  const { apiKey, shop } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey} shopOrigin={shop}>
      <s-app-nav>
        <s-link href="/app" rel="home">
          Dashboard
        </s-link>
        <s-link href="/app/option-sets">Option sets</s-link>
        <s-link href="/app/templates">Templates</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
