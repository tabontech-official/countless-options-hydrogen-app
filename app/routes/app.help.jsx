import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { FIELD_TYPES, MAX_UPLOAD_BYTES } from "../options";
import { themeEditorUrl } from "../options.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    themeEditorUrl: themeEditorUrl(session.shop),
    // Optional: set SUPPORT_EMAIL in .env to show the contact section.
    // eslint-disable-next-line no-undef
    supportEmail: process.env.SUPPORT_EMAIL || null,
  };
};

const MB = MAX_UPLOAD_BYTES / 1024 / 1024;
const typeNames = Object.values(FIELD_TYPES).map((t) => t.label);

// Short, always-visible guides, one section per group. Each describes what the app does
// today, so keep them in step with the code. `steps` are numbered, `list` is bulleted,
// `tip` is a tinted line, `action` a link (`theme` opens the theme editor).
const GUIDES = [
  {
    title: "Getting started",
    intro: "Set up an option set and get it onto your store.",
    articles: [
      {
        title: "Create an option set",
        steps: [
          "Go to Option sets and click Create option set, or start from a template.",
          "Add your questions and choose the products they appear on.",
          "Click Save.",
        ],
        action: { label: "Create option set", to: "/app/option-sets/new" },
      },
      {
        title: "Show options on your store",
        text: "Add the Product options block to your product page once. Every option set uses it.",
        steps: ["Click Open theme editor. The block is added to your product page.", "Move it above Add to cart and click Save."],
        action: { label: "Open theme editor", theme: true },
      },
      {
        title: "Choose products",
        list: [
          "Specific products: choose them in Shopify’s product picker.",
          "By conditions: tag, vendor, type, status, category, collection, sales channel or catalog, for example Tag is engraving.",
          "All products: every product, including ones you add later.",
        ],
        tip: "Conditions keep working on their own. Tag a product later and it gets the questions automatically, and the tag doesn’t have to exist yet.",
      },
      {
        title: "Hide a set",
        text: "Change its status to Draft and save. Switch back to Active to show it again.",
      },
    ],
  },
  {
    title: "Questions and pricing",
    intro: "Ask customers what you need and charge for extras.",
    articles: [
      {
        title: "Answer types",
        text: `${typeNames.slice(0, -1).join(", ")} and ${typeNames.at(-1)}. Any of them can be required or priced.`,
      },
      {
        title: "Charge extra",
        text: "Turn on Charge extra on a question. Price each paid choice, or set one price that's charged when the question is filled in, ticked or uploaded.",
      },
      {
        title: "Charge per letter or unit",
        text: "Add a Number question, such as Number of letters, with a lowest and highest value. Then set the priced question's Charge to that number.",
      },
      {
        title: "Follow-up questions",
        text: "Choose ⋮ → Add follow-up question, or turn on Depends on another answer. A follow-up only appears after a matching answer, and is never required or charged while hidden.",
      },
      {
        title: "Required questions",
        text: "Tick Required. Customers can't add to cart until it's answered.",
      },
      {
        title: "File uploads",
        text: `Customers can upload images, PDFs and Word, Excel, PowerPoint or text files up to ${MB} MB. Files are saved in Content → Files and linked on the order.`,
      },
    ],
  },
  {
    title: "Orders and checkout",
    intro: "What you see after a customer buys.",
    articles: [
      {
        title: "Customers' answers",
        text: "Open the order in Shopify admin. Answers are listed under the product, and uploaded files are links.",
      },
      {
        title: "Option charges",
        text: "Paid options are added at checkout, priced from your settings. A hidden product called Option add-ons carries the charge.",
        tip: "Don't delete Option add-ons. If it's ever removed, edit and save any active option set with prices to restore it.",
      },
    ],
  },
  {
    title: "Troubleshooting",
    intro: "Quick fixes for common problems.",
    articles: [
      {
        title: "Options don't show on a product",
        list: [
          "The option set is Active.",
          "The product is picked in the set, or matches its conditions.",
          "The Product options block is on your product template, and the theme is saved.",
          "Reinstalled the app? Remove the block and add it again.",
        ],
        action: { label: "Open theme editor", theme: true },
      },
      {
        title: "Add to cart doesn't work",
        text: "A required question (*) isn't answered yet, or a file is still uploading.",
      },
      {
        title: "Store speed",
        text: "Options load with the product page itself. The block’s script is under 10 KB, plus 3 KB on products with a file upload.",
      },
      {
        title: "Uninstalling",
        text: "Go to Settings → Apps, open Countless Options and click Uninstall. Options stop showing right away. Your option sets are kept for 48 hours in case you reinstall.",
      },
    ],
  },
];

export default function Help() {
  const { themeEditorUrl, supportEmail } = useLoaderData();

  return (
    <s-page heading="Help" inlineSize="large">
      <div className="co-wrap co-animate">
        {GUIDES.map((group) => (
          <section key={group.title} className="co-annotated">
            <div className="co-annotated__label">
              <h2>{group.title}</h2>
              <p>{group.intro}</p>
            </div>
            <div className="co-glass co-guides">
              {group.articles.map((a) => (
                <Article key={a.title} article={a} themeEditorUrl={themeEditorUrl} />
              ))}
            </div>
          </section>
        ))}

        {supportEmail && (
          <section className="co-annotated">
            <div className="co-annotated__label">
              <h2>Need help?</h2>
              <p>Can’t find the answer? Email us and we’ll help.</p>
            </div>
            <div className="co-glass co-card co-contact">
              <span className="co-tile" aria-hidden="true">
                <s-icon type="email" />
              </span>
              <p>Include your store address, the product you’re working on and a screenshot if you can.</p>
              {/* _blank: the admin's frame blocks navigating itself to mailto: ("This content is blocked"). */}
              <a
                className="co-btn co-btn--dark"
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("Countless Options help")}`}
                target="_blank"
                rel="noreferrer"
              >
                Send an email
              </a>
              <small>{supportEmail}</small>
            </div>
          </section>
        )}
      </div>
    </s-page>
  );
}

function Article({ article: a, themeEditorUrl }) {
  return (
    <article className="co-guide">
      <h3>{a.title}</h3>
      {a.text && <p>{a.text}</p>}
      {a.steps && (
        <ol>
          {a.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {a.list && (
        <ul>
          {a.list.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {a.tip && <p className="co-guide__tip">{a.tip}</p>}
      {a.action &&
        (a.action.theme ? (
          <a className="co-link" href={themeEditorUrl} target="_blank" rel="noreferrer">
            {a.action.label}
          </a>
        ) : (
          <Link className="co-link" to={a.action.to}>
            {a.action.label}
          </Link>
        ))}
    </article>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
