import { Form, useNavigation } from "react-router";

// Store address form for the landing and login pages. It posts to the page it sits on, whose
// action calls login(): that accepts "my-store", "my-store.myshopify.com" or a pasted URL.
// ponytail: App Store requirement 2.3.1 forbids asking for the shop domain. Once the listing is
// approved, swap this form for a link to the App Store listing.
export function InstallForm({ error, label = "Install app" }) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formData?.has("shop");

  return (
    <Form method="post" className="co-install">
      <label className="co-install__label" htmlFor="shop">
        Your Shopify store
      </label>
      <div className="co-install__row">
        <span className="co-install__field" data-invalid={Boolean(error)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 9.5 4.5 4h15L21 9.5M3 9.5h18M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8M10 20v-5h4v5" />
          </svg>
          <input
            id="shop"
            name="shop"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="your-store.myshopify.com"
            aria-invalid={Boolean(error)}
            aria-describedby="shop-hint"
          />
        </span>
        <button type="submit" className="co-btn co-btn--dark" disabled={busy}>
          {busy ? "Opening Shopify…" : `${label} →`}
        </button>
      </div>
      <p id="shop-hint" className={error ? "co-install__hint co-install__hint--error" : "co-install__hint"} role={error ? "alert" : undefined}>
        {error ?? "Your store name is enough, for example your-store."}
      </p>
    </Form>
  );
}
