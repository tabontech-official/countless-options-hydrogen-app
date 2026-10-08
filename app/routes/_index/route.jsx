import { useState } from "react";
import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { TEMPLATES } from "../../templates";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const meta = () => {
  return [
    { title: "Countless Options | Infinite Product Options & Customizer for Shopify" },
    {
      name: "description",
      content:
        "Break Shopify's 3-option limit. Create infinite customizable product options with conditional logic, add-on pricing, swatches, and 1-click templates.",
    },
  ];
};

export default function LandingPage() {
  const { showForm } = useLoaderData();
  const [shopDomain, setShopDomain] = useState("");
  const [activePreset, setActivePreset] = useState("engraved-jewelry");
  const [openFaq, setOpenFaq] = useState(0);

  // Interactive playground state
  const [selectedMetal, setSelectedMetal] = useState("Yellow gold");
  const [addEngraving, setAddEngraving] = useState(true);
  const [engravingText, setEngravingText] = useState("Love & Forever");
  const [addGiftBox, setAddGiftBox] = useState(true);

  // Apparel state
  const [apparelPlacement, setApparelPlacement] = useState("Front");
  const [apparelName, setApparelName] = useState("JORDAN");
  const [apparelNumber, setApparelNumber] = useState("23");

  // Gift wrap state
  const [giftWrap, setGiftWrap] = useState(true);
  const [wrapPaper, setWrapPaper] = useState("Gold foil");
  const [giftNote, setGiftNote] = useState("Happy Anniversary!");

  // Dynamic price calculator for demo
  const getDemoPrice = () => {
    if (activePreset === "engraved-jewelry") {
      let base = 89;
      if (selectedMetal === "Rose gold") base += 15;
      if (addEngraving) base += 10;
      if (addGiftBox) base += 5;
      return base;
    }
    if (activePreset === "custom-apparel") {
      let base = 35;
      if (apparelPlacement === "Back") base += 5;
      if (apparelPlacement === "Front and back") base += 8;
      if (apparelName.trim()) base += 6;
      return base;
    }
    if (activePreset === "gift-wrap") {
      let base = 49;
      if (giftWrap) base += 4.99;
      return base;
    }
    return 65;
  };

  const handleDomainSubmit = (e) => {
    let clean = shopDomain.trim().toLowerCase();
    if (!clean) return;
    if (!clean.includes(".")) {
      clean = `${clean}.myshopify.com`;
    }
    setShopDomain(clean);
  };

  const faqs = [
    {
      q: "Does Countless Options slow down my online store?",
      a: "No! Countless Options is built on native Shopify Online Store 2.0 App Blocks and lightweight web components. It loads asynchronously with zero theme code pollution or heavy runtime scripts.",
    },
    {
      q: "Can I charge extra money for specific options or upgrades?",
      a: "Yes! You can attach add-on price charges to any option value (e.g. +$10 for custom engraving, +$5 for gift box). Charges are calculated natively and seamlessly added to checkout via Shopify Functions.",
    },
    {
      q: "What is conditional logic and how does it work?",
      a: "Conditional logic lets you reveal follow-up inputs only when relevant. For example, if a buyer checks 'Add Custom Engraving', the engraving text input, font selector, and preview will automatically appear.",
    },
    {
      q: "Where do customer selections appear after an order is placed?",
      a: "All customer customizations are saved directly as Line Item Properties on the order in your Shopify Admin, packing slips, email notifications, and fulfillment software.",
    },
    {
      q: "Does this require editing Liquid theme code?",
      a: "Zero code required. Simply add the App Block inside your Shopify Theme Customizer with one click and position it wherever you want on your product page.",
    },
  ];

  return (
    <div className={styles.pageWrapper}>
      {/* NAVBAR */}
      <nav className={styles.navbar}>
        <div className={styles.navContainer}>
          <a href="#" className={styles.brand}>
            <img src="/app-logo.png" alt="Countless Options Logo" className={styles.brandLogo} />
            <span className={styles.brandTitle}>
              Countless Options
              <span className={styles.brandBadge}>Shopify App</span>
            </span>
          </a>

          <ul className={styles.navLinks}>
            <li><a href="#features" className={styles.navLink}>Features</a></li>
            <li><a href="#demo" className={styles.navLink}>Live Playground</a></li>
            <li><a href="#templates" className={styles.navLink}>Templates</a></li>
            <li><a href="#comparison" className={styles.navLink}>Compare</a></li>
            <li><a href="#faq" className={styles.navLink}>FAQ</a></li>
          </ul>

          <a href="#install" className={styles.navCta}>
            <span>Install App</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      </nav>

      {/* HERO */}
      <header className={styles.heroSection}>
        <div className={styles.heroGlow}></div>
        
        <div className={styles.heroBadge}>
          <span>✨</span>
          <span>Next-Gen Shopify Product Customizer & Option Sets</span>
        </div>

        <h1 className={styles.heroHeading}>
          Uncap Shopify’s 3-Option Limit.<br />
          <span className={styles.heroHighlight}>Infinite Customizations. Zero Code.</span>
        </h1>

        <p className={styles.heroSubtext}>
          Empower your buyers with custom text fields, color & image swatches, conditional logic, file uploads, and add-on price charges — rendered at blazing speed inside your Shopify theme.
        </p>

        {/* INSTALL / LOGIN CARD */}
        <div id="install" className={styles.installCard}>
          {showForm ? (
            <Form className={styles.installForm} method="post" action="/auth/login" onSubmit={handleDomainSubmit}>
              <div className={styles.inputGroup}>
                <span className={styles.inputIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                </span>
                <input
                  className={styles.storeInput}
                  type="text"
                  name="shop"
                  required
                  placeholder="your-store-name.myshopify.com"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  autoComplete="on"
                />
              </div>
              <button className={styles.submitBtn} type="submit">
                <span>Install on Shopify</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </Form>
          ) : (
            <p style={{ margin: 0, color: "#4b5563", fontWeight: 500 }}>
              Launch this app directly inside your Shopify Partner Dashboard or Shopify Admin.
            </p>
          )}

          <div className={styles.trustBadges}>
            <span className={styles.trustItem}>
              <svg className={styles.trustIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Theme 2.0 App Block
            </span>
            <span className={styles.trustItem}>
              <svg className={styles.trustIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              No Variant Bloat
            </span>
            <span className={styles.trustItem}>
              <svg className={styles.trustIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Free to Start
            </span>
          </div>
        </div>
      </header>

      {/* STATS SECTION */}
      <section className={styles.statsSection}>
        <div className={styles.statsGrid}>
          <div>
            <div className={styles.statNumber}>∞</div>
            <div className={styles.statLabel}>Custom Options & Fields</div>
          </div>
          <div>
            <div className={styles.statNumber}>+28%</div>
            <div className={styles.statLabel}>Average Order Value Boost</div>
          </div>
          <div>
            <div className={styles.statNumber}>12+</div>
            <div className={styles.statLabel}>Instant Industry Templates</div>
          </div>
          <div>
            <div className={styles.statNumber}>0 ms</div>
            <div className={styles.statLabel}>Shopify Storefront Delay</div>
          </div>
        </div>
      </section>

      {/* INTERACTIVE PLAYGROUND / LIVE DEMO */}
      <section id="demo" className={styles.playgroundSection}>
        <div className={styles.playgroundContainer}>
          <div className={styles.playgroundHeader}>
            <div className={styles.playgroundTitleGroup}>
              <span className={styles.liveIndicator}></span>
              <span className={styles.playgroundTitle}>Interactive Storefront Demo</span>
            </div>

            <div className={styles.presetTabs}>
              <button
                type="button"
                className={`${styles.presetTab} ${activePreset === "engraved-jewelry" ? styles.presetTabActive : ""}`}
                onClick={() => setActivePreset("engraved-jewelry")}
              >
                💍 Jewelry
              </button>
              <button
                type="button"
                className={`${styles.presetTab} ${activePreset === "custom-apparel" ? styles.presetTabActive : ""}`}
                onClick={() => setActivePreset("custom-apparel")}
              >
                👕 Custom Apparel
              </button>
              <button
                type="button"
                className={`${styles.presetTab} ${activePreset === "gift-wrap" ? styles.presetTabActive : ""}`}
                onClick={() => setActivePreset("gift-wrap")}
              >
                🎁 Gift Wrapping
              </button>
            </div>
          </div>

          <div className={styles.playgroundBody}>
            {/* PREVIEW SIDE */}
            <div className={styles.previewSide}>
              <div className={styles.previewImageFrame}>
                <img
                  src={`/templates/${activePreset}.jpg`}
                  alt={activePreset}
                  className={styles.previewImage}
                />
                <span className={styles.previewCustomBadge}>
                  {activePreset === "engraved-jewelry" && (addEngraving ? `Engraved: "${engravingText || "..."}"` : "Standard Finish")}
                  {activePreset === "custom-apparel" && `Custom: ${apparelName} #${apparelNumber}`}
                  {activePreset === "gift-wrap" && (giftWrap ? `Gift Wrapped: ${wrapPaper}` : "Standard Box")}
                </span>
              </div>

              <div className={styles.previewProductName}>
                {activePreset === "engraved-jewelry" && "Personalized Signet Ring"}
                {activePreset === "custom-apparel" && "Custom Team Jersey"}
                {activePreset === "gift-wrap" && "Artisan Perfume & Candle Set"}
              </div>

              <div className={styles.previewPriceTag}>
                <span className={styles.currentPrice}>${getDemoPrice().toFixed(2)}</span>
                <span className={styles.basePrice}>
                  {activePreset === "engraved-jewelry" && "$89.00"}
                  {activePreset === "custom-apparel" && "$35.00"}
                  {activePreset === "gift-wrap" && "$49.00"}
                </span>
                <span className={styles.priceNote}>Live Pricing Add-on</span>
              </div>
            </div>

            {/* OPTIONS CONTROLS */}
            <div className={styles.optionsSide}>
              <div className={styles.optionsForm}>
                {activePreset === "engraved-jewelry" && (
                  <>
                    <div className={styles.optionGroup}>
                      <div className={styles.optionLabelRow}>
                        <span className={styles.optionLabel}>Metal Choice <span className={styles.requiredStar}>*</span></span>
                        <span className={styles.optionSelectedValue}>{selectedMetal}</span>
                      </div>
                      <div className={styles.swatchGrid}>
                        {[
                          { name: "Yellow gold", color: "#d4af37", price: 0 },
                          { name: "Silver", color: "#c0c4ca", price: 0 },
                          { name: "Rose gold", color: "#b76e79", price: 15 },
                        ].map((swatch) => (
                          <button
                            key={swatch.name}
                            type="button"
                            title={`${swatch.name} ${swatch.price ? `(+$${swatch.price})` : ""}`}
                            className={`${styles.swatchBtn} ${selectedMetal === swatch.name ? styles.swatchBtnSelected : ""}`}
                            style={{ backgroundColor: swatch.color }}
                            onClick={() => setSelectedMetal(swatch.name)}
                          />
                        ))}
                      </div>
                    </div>

                    <div className={styles.optionGroup}>
                      <label
                        className={`${styles.addonCheckboxCard} ${addEngraving ? styles.addonCheckboxCardActive : ""}`}
                        onClick={() => setAddEngraving(!addEngraving)}
                      >
                        <div className={styles.addonLeft}>
                          <input
                            type="checkbox"
                            checked={addEngraving}
                            onChange={() => {}}
                          />
                          <span>Add Custom Engraving</span>
                        </div>
                        <span className={styles.addonPriceBadge}>+$10.00</span>
                      </label>
                    </div>

                    {addEngraving && (
                      <div className={styles.optionGroup}>
                        <div className={styles.optionLabelRow}>
                          <span className={styles.optionLabel}>Engraving Message</span>
                          <span className={styles.optionSelectedValue}>{engravingText.length}/20</span>
                        </div>
                        <input
                          type="text"
                          maxLength={20}
                          className={styles.customTextInput}
                          placeholder="e.g. Forever & Always"
                          value={engravingText}
                          onChange={(e) => setEngravingText(e.target.value)}
                        />
                      </div>
                    )}

                    <div className={styles.optionGroup}>
                      <label
                        className={`${styles.addonCheckboxCard} ${addGiftBox ? styles.addonCheckboxCardActive : ""}`}
                        onClick={() => setAddGiftBox(!addGiftBox)}
                      >
                        <div className={styles.addonLeft}>
                          <input
                            type="checkbox"
                            checked={addGiftBox}
                            onChange={() => {}}
                          />
                          <span>Luxury Velvet Gift Box</span>
                        </div>
                        <span className={styles.addonPriceBadge}>+$5.00</span>
                      </label>
                    </div>
                  </>
                )}

                {activePreset === "custom-apparel" && (
                  <>
                    <div className={styles.optionGroup}>
                      <span className={styles.optionLabel}>Print Placement</span>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        {[
                          { label: "Front", add: 0 },
                          { label: "Back", add: 5 },
                          { label: "Front and back", add: 8 },
                        ].map((p) => (
                          <button
                            key={p.label}
                            type="button"
                            className={`${styles.presetTab} ${apparelPlacement === p.label ? styles.presetTabActive : ""}`}
                            style={{ border: "1px solid #d1d5db" }}
                            onClick={() => setApparelPlacement(p.label)}
                          >
                            {p.label} {p.add ? `(+$${p.add})` : ""}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className={styles.optionGroup}>
                      <div className={styles.optionLabelRow}>
                        <span className={styles.optionLabel}>Custom Name (+ $6.00)</span>
                      </div>
                      <input
                        type="text"
                        maxLength={12}
                        className={styles.customTextInput}
                        placeholder="e.g. JORDAN"
                        value={apparelName}
                        onChange={(e) => setApparelName(e.target.value.toUpperCase())}
                      />
                    </div>

                    <div className={styles.optionGroup}>
                      <span className={styles.optionLabel}>Player Number</span>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        className={styles.customTextInput}
                        placeholder="0–99"
                        value={apparelNumber}
                        onChange={(e) => setApparelNumber(e.target.value)}
                      />
                    </div>
                  </>
                )}

                {activePreset === "gift-wrap" && (
                  <>
                    <div className={styles.optionGroup}>
                      <label
                        className={`${styles.addonCheckboxCard} ${giftWrap ? styles.addonCheckboxCardActive : ""}`}
                        onClick={() => setGiftWrap(!giftWrap)}
                      >
                        <div className={styles.addonLeft}>
                          <input
                            type="checkbox"
                            checked={giftWrap}
                            onChange={() => {}}
                          />
                          <span>Gift wrap this order</span>
                        </div>
                        <span className={styles.addonPriceBadge}>+$4.99</span>
                      </label>
                    </div>

                    {giftWrap && (
                      <>
                        <div className={styles.optionGroup}>
                          <div className={styles.optionLabelRow}>
                            <span className={styles.optionLabel}>Wrapping Paper</span>
                            <span className={styles.optionSelectedValue}>{wrapPaper}</span>
                          </div>
                          <div className={styles.swatchGrid}>
                            {[
                              { name: "Festive red", color: "#c8102e" },
                              { name: "Gold foil", color: "#d4af37" },
                              { name: "Kraft", color: "#b08a5a" },
                            ].map((s) => (
                              <button
                                key={s.name}
                                type="button"
                                className={`${styles.swatchBtn} ${wrapPaper === s.name ? styles.swatchBtnSelected : ""}`}
                                style={{ backgroundColor: s.color }}
                                onClick={() => setWrapPaper(s.name)}
                              />
                            ))}
                          </div>
                        </div>

                        <div className={styles.optionGroup}>
                          <span className={styles.optionLabel}>Gift Message</span>
                          <textarea
                            rows={3}
                            className={styles.customTextInput}
                            placeholder="Handwritten gift note message..."
                            value={giftNote}
                            onChange={(e) => setGiftNote(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                <button type="button" className={styles.demoAddToCartBtn}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1"/>
                    <circle cx="20" cy="21" r="1"/>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                  </svg>
                  <span>Add to Cart — ${getDemoPrice().toFixed(2)}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CORE FEATURES */}
      <section id="features" className={styles.featuresSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTag}>Engineered for Modern E-Commerce</span>
          <h2 className={styles.sectionTitle}>Everything You Need to Customize and Upsell</h2>
          <p className={styles.sectionDesc}>
            From personalized engravings to custom apparel, empower your customers to design exactly what they want without writing a line of code.
          </p>
        </div>

        <div className={styles.featuresGrid}>
          <div className={styles.featureCard}>
            <div className={styles.featureIconBox}>🎨</div>
            <h3 className={styles.featureCardTitle}>Color & Image Swatches</h3>
            <p className={styles.featureCardText}>
              Replace boring dropdown menus with sleek, visual circular/square color chips or thumbnail image swatches.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIconBox}>⚡</div>
            <h3 className={styles.featureCardTitle}>Smart Conditional Logic</h3>
            <p className={styles.featureCardText}>
              Show or hide options dynamically based on customer selections to keep your product forms ultra clean and intuitive.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIconBox}>💰</div>
            <h3 className={styles.featureCardTitle}>Native Add-On Pricing</h3>
            <p className={styles.featureCardText}>
              Charge extra for customizations, premium materials, and gift boxes. Seamlessly integrated with Shopify checkout.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIconBox}>📝</div>
            <h3 className={styles.featureCardTitle}>Versatile Input Types</h3>
            <p className={styles.featureCardText}>
              Text, multiline notes, number steppers, dropdowns, radio pills, checkboxes, and date pickers with validation.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIconBox}>📦</div>
            <h3 className={styles.featureCardTitle}>100% Theme 2.0 Native</h3>
            <p className={styles.featureCardText}>
              Drag-and-drop into your theme customizer with zero liquid edits, zero orphaned scripts, and lightning-fast load times.
            </p>
          </div>

          <div className={styles.featureCard}>
            <div className={styles.featureIconBox}>📋</div>
            <h3 className={styles.featureCardTitle}>Direct Admin Order Sync</h3>
            <p className={styles.featureCardText}>
              All buyer inputs are captured directly into Shopify order details and packing slips for smooth, error-free fulfillment.
            </p>
          </div>
        </div>
      </section>

      {/* TEMPLATES SHOWCASE */}
      <section id="templates" className={styles.templatesSection}>
        <div className={styles.templatesContainer}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTag}>Ready-Made Presets</span>
            <h2 className={styles.sectionTitle}>Launch in Seconds with 12+ Industry Templates</h2>
            <p className={styles.sectionDesc}>
              Jumpstart your store with pre-configured option sets designed specifically for your product catalog.
            </p>
          </div>

          <div className={styles.templateCardsGrid}>
            {TEMPLATES.slice(0, 8).map((tpl) => (
              <div key={tpl.id} className={styles.templateCard}>
                <img
                  src={`/templates/${tpl.id}.jpg`}
                  alt={tpl.name}
                  className={styles.templateCardImg}
                  loading="lazy"
                />
                <div className={styles.templateCardContent}>
                  <span className={styles.templateCategory}>{tpl.category}</span>
                  <h4 className={styles.templateName}>{tpl.name}</h4>
                  <p className={styles.templateDesc}>{tpl.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARISON TABLE */}
      <section id="comparison" className={styles.comparisonSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTag}>Why Choose Us</span>
          <h2 className={styles.sectionTitle}>Shopify Native vs. Countless Options</h2>
        </div>

        <table className={styles.comparisonTable}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Standard Shopify</th>
              <th>Countless Options ✨</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Option Limit</strong></td>
              <td>Max 3 Options (100 Variants)</td>
              <td><strong>Unlimited Options & Fields</strong></td>
            </tr>
            <tr>
              <td><strong>Conditional Logic</strong></td>
              <td>❌ Not supported</td>
              <td><strong>✅ Dynamic Reveal & Hide</strong></td>
            </tr>
            <tr>
              <td><strong>Price Add-ons</strong></td>
              <td>❌ Requires complex variant math</td>
              <td><strong>✅ Instant Add-on Pricing</strong></td>
            </tr>
            <tr>
              <td><strong>Custom Text & Notes</strong></td>
              <td>❌ Requires custom code</td>
              <td><strong>✅ Built-in validated text inputs</strong></td>
            </tr>
            <tr>
              <td><strong>Visual Swatches</strong></td>
              <td>⚠️ Limited theme support</td>
              <td><strong>✅ Color & thumbnail swatches</strong></td>
            </tr>
            <tr>
              <td><strong>Theme Compatibility</strong></td>
              <td>Standard</td>
              <td><strong>✅ 100% Theme 2.0 App Block</strong></td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* FAQ SECTION */}
      <section id="faq" className={styles.faqSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTag}>Frequently Asked Questions</span>
          <h2 className={styles.sectionTitle}>Got Questions? We’ve Got Answers.</h2>
        </div>

        <div className={styles.faqList}>
          {faqs.map((faq, index) => {
            const isOpen = openFaq === index;
            return (
              <div
                key={index}
                className={`${styles.faqItem} ${isOpen ? styles.faqItemOpen : ""}`}
              >
                <button
                  type="button"
                  className={styles.faqQuestion}
                  onClick={() => setOpenFaq(isOpen ? -1 : index)}
                >
                  <span>{faq.q}</span>
                  <svg
                    className={`${styles.faqChevron} ${isOpen ? styles.faqChevronRotated : ""}`}
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {isOpen && <div className={styles.faqAnswer}>{faq.a}</div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* CALL TO ACTION BANNER */}
      <section className={styles.ctaBanner}>
        <div className={styles.ctaCard}>
          <h2 className={styles.ctaTitle}>Ready to boost your average order value?</h2>
          <p className={styles.ctaSubtitle}>
            Install Countless Options today and offer your customers a truly personalized shopping experience.
          </p>
          <a href="#install" className={styles.submitBtn} style={{ margin: "0 auto" }}>
            <span>Get Started with Countless Options</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <div className={styles.footerContainer}>
          <div className={styles.footerBrand}>
            <img src="/app-logo.png" alt="Logo" style={{ width: 24, height: 24, borderRadius: 6 }} />
            <span>Countless Options</span>
          </div>
          <div className={styles.footerText}>
            © {new Date().getFullYear()} Countless Options. Built for Shopify merchants worldwide.
          </div>
        </div>
      </footer>
    </div>
  );
}
