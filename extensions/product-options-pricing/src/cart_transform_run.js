// @ts-check
import { priceSelection } from "./pricing";

/**
 * @typedef {import("../generated/api").CartTransformRunInput} CartTransformRunInput
 * @typedef {import("../generated/api").CartTransformRunResult} CartTransformRunResult
 * @typedef {import("../generated/api").Operation} Operation
 */

/** @type {CartTransformRunResult} */
const NO_CHANGES = { operations: [] };

// Charges option prices by expanding a priced line into the product (at its own price)
// plus the hidden "Option add-ons" variant priced at the options total. lineExpand works on
// every plan (lineUpdate is Shopify Plus only), and checkout and orders show both parts.
/**
 * @param {CartTransformRunInput} input
 * @returns {CartTransformRunResult}
 */
export function cartTransformRun(input) {
  const addonVariantId = input.cartTransform.addonVariant?.value;
  if (!addonVariantId) return NO_CHANGES;
  const rate = Number(input.presentmentCurrencyRate);

  /** @type {Operation[]} */
  const operations = [];
  for (const line of input.cart.lines) {
    // Bundles can't carry selling plans (subscriptions), so those lines keep their price.
    if (line.merchandise.__typename !== "ProductVariant" || line.sellingPlanAllocation || !line.selection?.value) continue;
    const fields = line.merchandise.product.options?.jsonValue;
    if (!Array.isArray(fields)) continue;

    let selection;
    try {
      selection = JSON.parse(line.selection.value);
    } catch {
      continue;
    }
    const { display, charges, total } = priceSelection(fields, selection);
    if (total <= 0) continue;

    const { amount, currencyCode } = line.cost.amountPerQuantity;
    const money = (/** @type {number} */ n) => (n * rate).toFixed(2);
    operations.push({
      lineExpand: {
        cartLineId: line.id,
        expandedCartItems: [
          {
            merchandiseId: line.merchandise.id,
            quantity: 1,
            price: { adjustment: { fixedPricePerUnit: { amount } } },
            // Keeps the customer's choices on the product's order line.
            attributes: display.map(({ label, value }) => ({ key: label, value })),
          },
          {
            merchandiseId: addonVariantId,
            quantity: 1,
            price: { adjustment: { fixedPricePerUnit: { amount: money(total) } } },
            // What was charged, shown on the add-on's order line.
            // e.g. "Gold, 3 × 50.00 (+150.00 USD)", or "3 × 50.00 (...)" when a count prices itself.
            attributes: charges.map(({ label, value, price, each, units, self }) => ({
              key: label,
              value: `${each === undefined ? value : `${self ? "" : `${value}, `}${units} × ${money(each)}`} (+${money(price)} ${currencyCode})`,
            })),
          },
        ],
      },
    });
  }
  return operations.length ? { operations } : NO_CHANGES;
}
