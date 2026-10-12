import { Link, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { appStoreUrl } from "../../options.server";
import { Brand } from "../../components/Brand";
import appStyles from "../../styles/app.css?url";

export const links = () => [{ rel: "stylesheet", href: appStyles }];

export const meta = () => [{ title: "Log in | Countless Options" }];

// Shopify sends merchants here with ?shop=… (login() then starts OAuth). Anyone arriving without
// it is pointed to their Shopify admin or the App Store: no store address field (App Store 2.3.1).
export const loader = async ({ request }) => {
  await login(request);
  return { appStoreUrl: appStoreUrl() };
};

export default function Auth() {
  const { appStoreUrl } = useLoaderData();

  return (
    <main className="co-login">
      <div className="co-glass co-login__card co-animate">
        <Link to="/" className="co-login__home" aria-label="Countless Options home">
          <Brand />
        </Link>
        <h1 className="co-heading co-heading--small">
          Open Countless Options <em>in Shopify</em>
        </h1>
        <p className="co-login__lede">The app runs inside your Shopify admin, so there’s no separate sign-in.</p>
        <ol className="co-login__steps">
          <li>
            <span aria-hidden="true">1</span>
            <div>
              <strong>Open your Shopify admin</strong>
              <small>admin.shopify.com</small>
            </div>
          </li>
          <li>
            <span aria-hidden="true">2</span>
            <div>
              <strong>Go to Apps → Countless Options</strong>
              <small>Your option sets and settings are there.</small>
            </div>
          </li>
        </ol>
        <div className="co-actions">
          <a className="co-btn co-btn--dark" href="https://admin.shopify.com" target="_top" rel="noopener">
            Open Shopify admin →
          </a>
          <a className="co-btn co-btn--glass" href={appStoreUrl} target="_top" rel="noopener">
            Get it on the App Store
          </a>
        </div>
      </div>
    </main>
  );
}
