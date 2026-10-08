import { Link, useActionData, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { Brand } from "../../components/Brand";
import { InstallForm } from "../../components/InstallForm";
import appStyles from "../../styles/app.css?url";
import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: appStyles }];

export const meta = () => [{ title: "Log in | Countless Options" }];

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const { errors } = actionData || loaderData;

  return (
    <main className="co-login">
      <div className="co-glass co-login__card co-animate">
        <Link to="/" aria-label="Countless Options home">
          <Brand />
        </Link>
        <h1 className="co-heading co-heading--small">
          Log in to <em>your store</em>
        </h1>
        <p>Enter your store name and we’ll open Countless Options in your Shopify admin.</p>
        <InstallForm error={errors.shop} label="Log in" />
      </div>
    </main>
  );
}
