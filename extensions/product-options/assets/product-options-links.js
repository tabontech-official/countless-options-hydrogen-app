// "Upload links" app embed: the cart shows an uploaded file as "View image file" (set by
// product-options-upload.js); this turns that text into a link that opens the file in a new tab.
// The URLs are in the line's hidden _options property, read from /cart.js. Loaded on every page
// by the embed, and by the product options block (so a product page's cart drawer works without
// the embed); it does nothing until such a label is on the page.
(() => {
  if (window.poLinks) return; // the embed and the block may both load it
  window.poLinks = true;
  const { viewImage, viewFile } = document.currentScript.dataset;
  const labels = [viewImage, viewFile];
  const FILE = /^https:\/\/cdn\.shopify\.com\/s\/files\//; // Shopify Files, as proxy.upload.jsx returns

  // Text nodes that are exactly a label, in page order, including ones already linked
  // (data-po-link) so the nth label of a line still maps to its nth upload.
  const labelled = () => {
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode;
      // "View image file", or "View image file (+$5.00)" when the upload has a price.
      const text = node.data.trim();
      const isLabel = labels.some((l) => text === l || text.startsWith(`${l} (+`));
      if (isLabel && !node.parentElement.closest("a:not([data-po-link]), script, style")) found.push(node);
    }
    return found;
  };
  const tried = new WeakSet(); // labels already looked at; a theme re-render makes new ones
  const done = (node) => tried.has(node) || node.parentElement.closest("[data-po-link]");

  // Which line each cart control names: /cart/change links (remove, +/-) by key, variant or
  // position, or Dawn's data-index on its remove button and quantity box.
  const LINE = 'a[href*="/cart/change"], cart-remove-button[data-index], [name="updates[]"][data-index]';
  const idOf = (el) => {
    if (el.dataset.index) return `line:${el.dataset.index}`;
    const q = new URL(el.href, location.href).searchParams;
    return q.get("id") ?? `line:${q.get("line")}`;
  };

  // The uploads a label can belong to: those of the line named by the closest element whose
  // cart controls all name one line. With no controls anywhere (Dawn's "added to cart" pop-up
  // shows the newest line, which /cart.js lists first), every upload in cart order.
  // ponytail: that fallback can link the wrong file if the pop-up shows a line that was merged
  // into an older one; read the /cart/add response if that matters.
  // A control's line as an index into /cart.js items; -1 if it can't be told (a variant id that
  // several lines share: one per upload).
  const indexOf = (id, items) => {
    if (id.startsWith("line:")) return id.slice(5) - 1;
    const hits = items.flatMap((item, i) => (item.key === id || String(item.id) === id ? [i] : []));
    return hits.length === 1 ? hits[0] : -1;
  };
  const filesOf = (node, items) => {
    for (let row = node.parentElement; row; row = row.parentElement) {
      // Dawn's cart page names a row twice (remove link by key, data-index by position): same line.
      const lines = new Set([...row.querySelectorAll(LINE)].map((el) => indexOf(idOf(el), items)));
      if (lines.size > 1 || lines.has(-1)) return null;
      if (lines.size) {
        const [line] = lines;
        return items[line] ? { row, files: uploads(items[line]) } : null;
      }
    }
    return { row: document, files: items.flatMap(uploads) };
  };

  const uploads = (item) => {
    try {
      return Object.values(JSON.parse(item.properties?._options ?? "{}")).filter((v) => typeof v === "string" && FILE.test(v));
    } catch {
      return [];
    }
  };

  let busy = false;
  let again = false;
  const run = async () => {
    if (busy) return void (again = true);
    if (labelled().every(done)) return;
    busy = true;
    try {
      const { items } = await (await fetch(`${window.Shopify?.routes?.root ?? "/"}cart.js`)).json();
      const seen = new Map(); // row -> labels so far: the nth label is the line's nth upload
      for (const node of labelled()) {
        const at = filesOf(node, items);
        const n = at ? (seen.get(at.row) ?? 0) : 0;
        if (at) seen.set(at.row, n + 1);
        if (done(node)) continue;
        tried.add(node);
        const href = at?.files[n];
        if (!href) continue;
        const link = Object.assign(document.createElement("a"), { href, target: "_blank", rel: "noopener", textContent: node.data.trim() });
        link.dataset.poLink = "";
        node.replaceWith(link);
      }
    } catch {
      // Cart unavailable: the label stays plain text.
    } finally {
      busy = false;
      if (again) {
        again = false;
        run();
      }
    }
  };

  // Cart drawers re-render on every change. At most one check per 100 ms, however busy the page.
  let timer = null;
  new MutationObserver(() => {
    timer ??= setTimeout(() => {
      timer = null;
      run();
    }, 100);
  }).observe(document.body, { childList: true, subtree: true });
  run();
})();
