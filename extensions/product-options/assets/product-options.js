(() => {
  const FORM = 'form[action*="/cart/add"]';
  const BUY = '[type="submit"], [name="add"], .shopify-payment-button, shopify-accelerated-checkout';
  const cents = (n) => Math.round((Number(n) || 0) * 100);
  const el = (tag, props) => Object.assign(document.createElement(tag), props);

  // Theme's add-to-cart form; skips Dawn-style hidden installments forms.
  function findForm(root) {
    for (const scope of [root.closest(".shopify-section"), document]) {
      const forms = [...(scope?.querySelectorAll(FORM) ?? [])].filter((f) => !f.matches('.installment, [id*="installment"]'));
      const form = forms.find((f) => f.querySelector('[type="submit"], [name="add"]')) ?? forms[0];
      if (form) return form;
    }
    return null;
  }

  // Answers + unmultiplied price (shop cents). Numbers: same rules as pricing.js.
  function read(field) {
    const input = field.querySelector(".po__input");
    const fee = cents(field.dataset.poPrice);
    if (input?.type === "number") {
      let n = input.value === "" ? NaN : Number(input.value);
      if (!Number.isFinite(n)) return { values: [] };
      if (input.step === "1") n = Math.round(n);
      if (input.min !== "") n = Math.max(n, Number(input.min));
      if (input.max !== "") n = Math.min(n, Number(input.max));
      return { values: [String(n)], base: fee, n };
    }
    if (input?.tagName === "SELECT") {
      const option = input.selectedOptions[0];
      return option?.value ? { values: [option.value], base: cents(option.dataset.poPrice) } : { values: [] };
    }
    if (input) {
      const text = input.value.trim();
      return text ? { values: [text], base: fee } : { values: [] };
    }
    const checked = [...field.querySelectorAll("input:checked")];
    return { values: checked.map((c) => c.value), base: checked.reduce((sum, c) => sum + (c.dataset.poPrice ? cents(c.dataset.poPrice) : fee), 0) };
  }

  function init(root) {
    if (root.dataset.poReady) return;
    root.dataset.poReady = "true";
    const fields = [...root.querySelectorAll("[data-po-field]")];
    const byId = (id) => root.querySelector(`[data-po-id="${id}"]`);
    const controls = [...root.querySelectorAll("input, select, textarea")];
    const shownFor = new Map(fields.map((f) => [f, f.dataset.poWhen && JSON.parse(f.dataset.poValues)]));
    const summary = root.querySelector("[data-po-summary]");
    const $ = (selector) => summary.querySelector(selector);
    const variantIds = JSON.parse(root.dataset.poVariantIds);
    const variantPrices = JSON.parse(root.dataset.poVariantPrices);

    // Shop-currency prices in the customer's currency, converted like checkout.
    const { active = root.dataset.poCurrency, rate = 1 } = window.Shopify?.currency ?? {};
    const format = new Intl.NumberFormat(document.documentElement.lang || undefined, { style: "currency", currency: active });
    const money = (shopCents) => format.format((shopCents / 100) * Number(rate));
    // "+$50.00 per tooth" for "for each" prices.
    const suffix = (field) => {
      const unit = field.dataset.poPer && byId(field.dataset.poPer)?.dataset.poUnit;
      return field.dataset.poPer ? ` ${unit ? `${root.dataset.poPerLabel} ${unit}` : root.dataset.poEachLabel}` : "";
    };
    for (const tag of root.querySelectorAll("[data-po-amount]")) {
      tag.textContent = ` +${money(cents(tag.dataset.poAmount))}${suffix(tag.closest("[data-po-field]"))}`;
    }
    for (const option of root.querySelectorAll("option[data-po-price]")) {
      option.textContent += ` (+${money(cents(option.dataset.poPrice))}${suffix(option.closest("[data-po-field]"))})`;
    }

    let picked = []; // visible fields with an answer: { field, values, base, units, price }

    // Follow-ups need a matching answer above; hidden fields are disabled.
    const evaluate = () => {
      const answers = new Map();
      const numbers = new Map();
      const shown = new Set();
      picked = [];
      for (const field of fields) {
        const match = shownFor.get(field);
        const visible = !match || (answers.get(field.dataset.poWhen) ?? []).some((v) => match.includes(v));
        field.hidden = !visible;
        for (const control of field.querySelectorAll("input, select, textarea")) control.disabled = !visible;
        if (!visible) continue;
        shown.add(field.dataset.poId);
        const answer = read(field);
        if (!answer.values.length) continue;
        answers.set(field.dataset.poId, answer.values);
        if (answer.n !== undefined) numbers.set(field.dataset.poId, answer.n);
        picked.push({ field, ...answer });
      }
      // "For each" × a number field: blank = its min, hidden = 0 (as pricing.js).
      for (const p of picked) {
        const per = p.field.dataset.poPer;
        const fallback = shown.has(per) ? Number(byId(per).querySelector(".po__input").min) || 0 : 0;
        p.units = per ? Math.max(numbers.get(per) ?? fallback, 0) : 1;
        p.price = Math.round(p.base * p.units);
      }
    };

    // Shopify only reads properties inside the product form: copy answers + _options there.
    const mirror = () => {
      const form = findForm(root);
      if (!form) return;
      let box = form.querySelector(`[data-po-mirror="${root.id}"]`);
      if (!box) {
        box = el("div", { hidden: true });
        box.dataset.poMirror = root.id;
        form.append(box);
      }
      const hidden = (name, value) => el("input", { type: "hidden", name, value });
      const options = Object.fromEntries(
        picked.map(({ field, values }) => [field.dataset.poId, field.querySelector("select, [type=radio], [data-po-multi]") ? values : values[0]]),
      );
      box.replaceChildren(
        ...picked.map(({ field, values }) => hidden(`properties[${field.dataset.poLabel}]`, values.join(", "))),
        ...(picked.length ? [hidden("properties[_options]", JSON.stringify(options))] : []),
      );
    };

    // Breakdown: each extra, options total, product + options.
    const render = () => {
      const total = picked.reduce((sum, p) => sum + p.price, 0);
      summary.hidden = !total;
      if (!total) return;
      $("[data-po-summary-lines]").replaceChildren(
        ...picked
          .filter((p) => p.price)
          .map(({ field, values, base, units, price }) => {
            const per = field.dataset.poPer;
            const count = `${units} × ${money(base)}`;
            const answer = !per ? values.join(", ") : per === field.dataset.poId ? count : `${values.join(", ")}, ${count}`;
            const row = el("p", { className: "po__summary-row" });
            row.append(el("span", { textContent: `${field.dataset.poLabel}: ${answer}` }), el("span", { textContent: `+${money(price)}` }));
            return row;
          }),
      );
      $("[data-po-options-total]").textContent = `+${money(total)}`;
      // Liquid variant prices are already converted.
      const base = variantPrices[variantIds.indexOf(Number(findForm(root)?.querySelector('[name="id"]')?.value))];
      $("[data-po-grand]").hidden = base == null;
      if (base != null) $("[data-po-grand-total]").textContent = format.format(base / 100 + (total / 100) * Number(rate));
    };

    const update = () => {
      evaluate();
      for (const field of fields) {
        const counter = field.querySelector("[data-po-count]");
        const input = field.querySelector(".po__input");
        if (counter) counter.textContent = `${input.value.length}/${input.maxLength}`;
        const value = picked.find((p) => p.field === field)?.values.join(", ") ?? "";
        const shown = field.querySelector("[data-po-picked]");
        if (shown) shown.textContent = value && `: ${value}`;
        field.querySelector("[data-po-required]")?.setCustomValidity(value ? "" : root.dataset.poPickOne);
      }
      // CSS dims the section's buy buttons while this is set.
      root.classList.toggle("po--blocked", controls.some((c) => !c.checkValidity()));
      render();
      mirror();
    };
    root.addEventListener("input", update);
    root.addEventListener("change", update);
    // − / + respect min and max.
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-po-step]");
      if (!button) return;
      const input = button.parentElement.querySelector(".po__input");
      if (button.dataset.poStep === "1") input.stepUp();
      else input.stepDown();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Variant change: refresh the total.
    document.addEventListener("change", (event) => {
      if (root.isConnected && !root.contains(event.target)) render();
    });
    update();

    // Block add to cart / Buy it now until valid (capture phase runs before theme handlers).
    const guard = (event) => {
      const form = root.isConnected && findForm(root);
      if (!form) return;
      if (event.type === "submit" ? event.target !== form : !form.contains(event.target.closest?.(BUY))) return;
      const invalid = controls.find((c) => !c.checkValidity());
      if (!invalid) return mirror();
      event.preventDefault();
      event.stopImmediatePropagation();
      root.classList.add("po--checked");
      invalid.reportValidity();
    };
    document.addEventListener("submit", guard, true);
    document.addEventListener("click", guard, true);
  }

  const boot = () => document.querySelectorAll("[data-po-root]").forEach(init);
  boot();
  // Re-init when themes re-render sections.
  new MutationObserver(boot).observe(document.body, { childList: true, subtree: true });
})();
