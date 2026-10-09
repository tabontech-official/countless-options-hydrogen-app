// "File upload" questions: sends the chosen file to the shop's Files through the app proxy
// (app/routes/proxy.upload.jsx), then puts the file's URL in the field's hidden .po__input,
// which product-options.js saves on the order like any other answer. Loaded only on
// products with an upload question; kept apart from product-options.js for its size limit.
(() => {
  if (window.poUploads) return; // one listener, however many blocks load this
  window.poUploads = true;
  const PROXY = "/apps/countless-options/upload"; // [app_proxy] in shopify.app.toml
  const MAX = 10 * 1024 * 1024; // MAX_UPLOAD_BYTES in app/options.js; the server enforces it

  const proxy = async (body) => {
    const res = await fetch(PROXY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error);
    return json;
  };

  document.addEventListener("change", async (event) => {
    const picker = event.target.closest?.(".po__file");
    if (!picker) return;
    const root = picker.closest("[data-po-root]");
    const field = picker.closest("[data-po-field]");
    const answer = field.querySelector(".po__input");
    const status = field.querySelector("[data-po-upload-status]");
    const file = picker.files[0];
    const pick = (field.dataset.poPick = String(Date.now())); // only the latest choice counts
    // Until it's uploaded the file blocks add to cart (busy: blocked, but not shown as an error);
    // the input event makes product-options.js re-check.
    const show = (text, problem, busy = false) => {
      if (field.dataset.poPick !== pick) return;
      status.textContent = text;
      status.classList.toggle("po__upload-status--error", Boolean(problem) && !busy);
      picker.toggleAttribute("data-po-busy", busy);
      picker.setCustomValidity(problem ?? "");
      answer.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const message = (code) =>
      ({ type: root.dataset.poUploadType, size: root.dataset.poUploadSize })[code] ?? root.dataset.poUploadFailed;

    answer.value = "";
    if (!file) return show("");
    if (file.size > MAX) return show(message("size"), message("size"));
    show(root.dataset.poUploading, root.dataset.poUploading, true);
    try {
      const target = await proxy({ intent: "stage", filename: file.name, fileSize: file.size });
      const form = new FormData();
      for (const { name, value } of target.parameters) form.append(name, value);
      form.append("file", file);
      if (!(await fetch(target.url, { method: "POST", body: form })).ok) throw new Error();
      const { url } = await proxy({ intent: "create", resourceUrl: target.resourceUrl, token: target.token });
      if (field.dataset.poPick !== pick) return;
      answer.value = url;
      show(`${root.dataset.poUploaded}: ${file.name}`);
    } catch (error) {
      show(message(error.message), message(error.message));
    }
  });
})();
