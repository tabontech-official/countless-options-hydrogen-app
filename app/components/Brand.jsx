// The app's logo and name, as it sits at the top of the dashboard, landing and login pages.
// The name beside it already says what it is, so the image is decorative (empty alt).
export function Brand() {
  return (
    <span className="co-brand">
      <img className="co-brand__logo" src="/logo.png" alt="" width="44" height="44" decoding="async" />
      <span>
        <strong>Countless</strong>
        <small>Product Options</small>
      </span>
    </span>
  );
}
