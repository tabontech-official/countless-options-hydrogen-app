import { redirect, useActionData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "../auth.login/error.server";
import { FIELD_TYPES, MAX_FIELDS } from "../../options";
import { TEMPLATES } from "../../templates";
import { Brand } from "../../components/Brand";
import { Capabilities } from "../../components/Capabilities";
import { InstallForm } from "../../components/InstallForm";
import { TryIt } from "../../components/TryIt";
// Imported (not linked) so the dashboard's styles load first and this page's layout comes after.
import "../../styles/app.css";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

// Same as /auth/login, so a mistyped store shows its message right here.
export const action = async ({ request }) => loginErrorMessage(await login(request));

export const meta = () => [
  { title: "Countless Options | Unlimited product options for Shopify" },
  {
    name: "description",
    content:
      "Go past Shopify's three-option limit. Add custom text, swatches, conditional questions and paid add-ons to any product, priced live and carried through to checkout.",
  },
];

const SECTIONS = [
  ["features", "Features"],
  ["how", "How it works"],
  ["templates", "Templates"],
  ["faq", "FAQ"],
];

// Every number comes from the app itself, so the page can't drift from what it does.
const FACTS = [
  [Object.keys(FIELD_TYPES).length, "field types"],
  [TEMPLATES.length, "ready-made templates"],
  [MAX_FIELDS, "questions per option set"],
  [0, "lines of theme code"],
];

const STEPS = [
  ["Install the app", "Enter your store name above and approve the install in your Shopify admin."],
  ["Create an option set", "Start from a template or from scratch, then assign it by product, collection, tag or category."],
  ["Add the block to your theme", "In the theme editor, add the Product options block to your product page. Done."],
];

const FAQS = [
  [
    "Will it slow down my store?",
    "No. Options load with the product itself, so your storefront never waits on our servers. The block adds one small script, under 10 KB.",
  ],
  [
    "How are option prices charged?",
    "Paid answers are added to the cart line by Shopify Functions, so the checkout total is always right. Prices come from your settings, never from the browser.",
  ],
  [
    "Does it work with my theme?",
    "It works with any Online Store 2.0 theme. You place the Product options block in the theme editor, with no code to edit.",
  ],
  [
    "Where do I see what customers chose?",
    "Every answer is saved on the order line, so it shows on the order in your Shopify admin next to the product.",
  ],
  [
    "Do I still need variants?",
    "Keep variants for what you stock, like size and color. Everything else, like engraving, gift wrap or a custom name, lives in an option set, so you never hit Shopify's three-option limit.",
  ],
  [
    "Can a question appear only when it's needed?",
    "Yes. Any question can depend on an earlier answer, for example engraving text only when engraving is ticked. Hidden questions are never charged.",
  ],
];

const focusInstall = () => document.getElementById("shop")?.focus();

export default function Landing() {
  const errors = useActionData();

  return (
    <div className={styles.page}>
      <div className={styles.orbs} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <header className={`co-glass ${styles.nav}`}>
        <a href="#top" className={styles.home} aria-label="Countless Options home">
          <Brand />
        </a>
        <nav className={styles.links} aria-label="Sections">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <a className="co-btn co-btn--dark co-btn--small" href="#install">
          Install app
        </a>
      </header>

      <main id="top" className="co-animate">
        <section className={`co-hero ${styles.hero}`}>
          <div>
            <span className={styles.eyebrow}>Product options for Shopify</span>
            <h1 className={`co-hero__title ${styles.title}`}>
              Shopify stops at three options. <em>You don’t have to.</em>
            </h1>
            <p className={`co-hero__body ${styles.lede}`}>
              Add engraving, gift wrap, custom text, swatches and paid add-ons to any product. Prices update live on the
              product page and carry through to checkout. No variants, no code.
            </p>
            <div id="install" className={`co-glass ${styles.install}`}>
              <InstallForm error={errors?.shop} />
            </div>
            <ul className={styles.trust}>
              <li>Theme app block, no code edits</li>
              <li>Charges added at checkout</li>
              <li>Answers saved on every order</li>
            </ul>
          </div>

          <div className={styles.demo}>
            <TryIt onAddToCart={focusInstall} />
            <span className={`co-glass ${styles.chip} ${styles.chipTop}`} aria-hidden="true">
              <i className={styles.dot} />
              Follow-up shown when ticked
            </span>
            <span className={`co-glass ${styles.chip} ${styles.chipBottom}`} aria-hidden="true">
              Charged at checkout
              <b className="co-mono co-up">+$10.00</b>
            </span>
          </div>
        </section>

        <section className={`co-glass ${styles.facts}`} aria-label="At a glance">
          {FACTS.map(([value, label]) => (
            <div key={label}>
              <strong className="co-mono">{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </section>

        <section id="features" className={styles.section}>
          <div className="co-center">
            <h2 className="co-heading">
              Everything a custom product needs. <em>Nothing it doesn’t.</em>
            </h2>
            <p>Keep size and color as variants. Everything else lives in an option set.</p>
          </div>
          <Capabilities />
        </section>

        <section id="how" className={styles.section}>
          <div className="co-center">
            <h2 className="co-heading">
              Live in <em>three steps</em>
            </h2>
            <p>From install to a live product page, without touching theme code.</p>
          </div>
          <ol className={`co-glass co-setup co-steps ${styles.steps}`}>
            {STEPS.map(([title, body], i) => (
              <li key={title} className="co-step">
                <span className={`co-step__tag co-mono ${styles.stepNum}`}>{String(i + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="templates" className={styles.section}>
          <div className="co-blockhead">
            <h2 className="co-heading">
              Start from a <em>template</em>
            </h2>
            <span className={styles.muted}>{`${TEMPLATES.length} ready to use`}</span>
          </div>
          <div className={`co-templates ${styles.templates}`}>
            {TEMPLATES.slice(0, 8).map((t) => (
              <article key={t.id} className={`co-template ${styles.template}`}>
                <span className="co-template__cover" style={{ background: t.tint }}>
                  <img src={`/templates/${t.id}.jpg`} alt="" width="640" height="400" loading="lazy" decoding="async" />
                </span>
                <span className="co-template__name">{t.name}</span>
                <span className="co-template__desc">{t.description}</span>
              </article>
            ))}
          </div>
        </section>

        <section id="faq" className={styles.section}>
          <div className="co-center">
            <h2 className="co-heading">
              Questions, <em>answered</em>
            </h2>
          </div>
          <div className={styles.faq}>
            {FAQS.map(([q, a]) => (
              <details key={q} className={`co-glass ${styles.faqItem}`}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`co-glass ${styles.cta}`}>
          <div>
            <h2 className="co-heading co-heading--small">
              Give every product <em>the options it deserves.</em>
            </h2>
            <p>Set up your first option set from a template or from scratch.</p>
          </div>
          <a className="co-btn co-btn--dark" href="#install">
            Install app →
          </a>
        </section>
      </main>

      <footer className="co-foot">
        <span>{`© ${new Date().getFullYear()} Countless Options`}</span>
        <span>Unlimited product options for Shopify stores</span>
      </footer>
    </div>
  );
}
