// What the app does: four small glass cards, each with one sentence and one line of the
// storefront as it would really read. Only features the app has.
const FEATURES = [
  {
    title: "Unlimited options",
    body: "Swatches, buttons, dropdowns, dates and text, as many as a product needs.",
    demo: ["Name on shirt", "free"],
  },
  {
    title: "Conditional logic",
    body: "Show a follow-up only when an earlier answer calls for it. Hidden fields are never charged.",
    demo: ["If engraving → lettering"],
    warm: true,
  },
  {
    title: "Paid add-ons",
    body: "Flat, per unit or per letter. The total updates as customers choose.",
    demo: ["12 stems × $3", "+$36"],
    warm: true,
  },
  {
    title: "Cart to order",
    body: "Every answer and charge carries through to the cart, checkout and the order you fulfill.",
    demo: ["Gift box", "+$5"],
    wide: true,
  },
];

export function Capabilities() {
  return (
    <div className="co-features">
      {FEATURES.map((f, i) => (
        <article
          key={f.title}
          className={["co-glass", "co-feature", f.wide && "co-feature--wide", f.warm && "co-feature--warm"]
            .filter(Boolean)
            .join(" ")}
        >
          <span className="co-feature__num">{String(i + 1).padStart(2, "0")}</span>
          <h3 className="co-feature__title">{f.title}</h3>
          <p className="co-feature__body">{f.body}</p>
          <span className="co-feature__demo" aria-hidden="true">
            <span>{f.demo[0]}</span>
            {f.demo[1] && <span className={f.demo[1] === "free" ? "co-mono" : "co-mono co-up"}>{f.demo[1]}</span>}
          </span>
        </article>
      ))}
    </div>
  );
}
