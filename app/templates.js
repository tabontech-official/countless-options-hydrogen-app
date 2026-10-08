import { hasPrices, newField } from "./options.js";

// Ready-made option sets merchants can start from. Fields use short keys so follow-ups can
// point at their parent; templateFields() swaps them for fresh IDs.
// Each card shows public/templates/<id>.jpg (Unsplash License photos), over `tint` while it loads.
export const TEMPLATES = [
  {
    id: "engraved-jewelry",
    name: "Engraved jewelry",
    category: "Jewelry",
    description: "Metal choice, optional engraving and a gift box.",
    tint: "#f3efe6",
    fields: [
      {
        key: "metal",
        type: "swatch",
        label: "Metal",
        required: true,
        choices: [
          { label: "Yellow gold", color: "#d4af37" },
          { label: "Silver", color: "#c0c4ca" },
          { label: "Rose gold", color: "#b76e79", price: 15 },
        ],
      },
      { key: "engrave", type: "checkbox", label: "Add engraving", price: 10 },
      {
        key: "text",
        type: "text",
        label: "Engraving text",
        required: true,
        maxLength: 20,
        placeholder: "Up to 20 characters",
        condition: { key: "engrave", values: ["Yes"] },
      },
      { key: "box", type: "checkbox", label: "Gift box", price: 5 },
    ],
  },
  {
    id: "custom-apparel",
    name: "Custom apparel",
    category: "Clothing",
    description: "Print placement, a custom name and number, and a font.",
    tint: "#e8f0fb",
    fields: [
      {
        key: "placement",
        type: "radio",
        label: "Print placement",
        required: true,
        choices: [{ label: "Front" }, { label: "Back", price: 5 }, { label: "Front and back", price: 8 }],
      },
      { key: "name", type: "text", label: "Name on shirt", maxLength: 12, placeholder: "e.g. ALEX", price: 6 },
      { key: "number", type: "number", label: "Number", min: 0, max: 99, placeholder: "0–99" },
      {
        key: "font",
        type: "select",
        label: "Font",
        choices: [{ label: "Classic" }, { label: "Varsity" }, { label: "Script" }],
      },
    ],
  },
  {
    id: "gift-wrap",
    name: "Gift wrapping",
    category: "Gifts",
    description: "Wrapping paper, a handwritten note and a delivery date.",
    tint: "#fbeaf0",
    fields: [
      { key: "wrap", type: "checkbox", label: "Gift wrap this item", price: 4.99 },
      {
        key: "paper",
        type: "swatch",
        label: "Wrapping paper",
        required: true,
        condition: { key: "wrap", values: ["Yes"] },
        choices: [
          { label: "Festive red", color: "#c8102e" },
          { label: "Gold foil", color: "#d4af37" },
          { label: "Kraft", color: "#b08a5a" },
        ],
      },
      {
        key: "note",
        type: "textarea",
        label: "Gift message",
        maxLength: 200,
        placeholder: "We'll handwrite it on a card",
        condition: { key: "wrap", values: ["Yes"] },
      },
      { key: "date", type: "date", label: "Deliver on" },
    ],
  },
  {
    id: "made-to-measure",
    name: "Made to measure",
    category: "Home",
    description: "Width and height, lining and fitting extras for curtains or blinds.",
    tint: "#e7f5ef",
    fields: [
      { key: "width", type: "number", label: "Width", unit: "cm", min: 30, max: 300, required: true },
      { key: "height", type: "number", label: "Drop", unit: "cm", min: 30, max: 300, required: true },
      {
        key: "lining",
        type: "radio",
        label: "Lining",
        required: true,
        choices: [{ label: "Unlined" }, { label: "Blackout", price: 20 }, { label: "Thermal", price: 25 }],
      },
      { key: "hooks", type: "checkbox", label: "Include fitting hooks", price: 8 },
    ],
  },
  {
    id: "custom-cake",
    name: "Custom cake",
    category: "Food",
    description: "Size, flavor, dietary needs, a message and a pickup date.",
    tint: "#fdf1e3",
    fields: [
      {
        key: "size",
        type: "radio",
        label: "Size",
        required: true,
        choices: [{ label: "6 inch" }, { label: "8 inch", price: 12 }, { label: "10 inch", price: 20 }],
      },
      {
        key: "flavor",
        type: "select",
        label: "Flavor",
        required: true,
        choices: [{ label: "Vanilla" }, { label: "Chocolate" }, { label: "Red velvet", price: 4 }],
      },
      {
        key: "diet",
        type: "checkboxes",
        label: "Dietary needs",
        choices: [{ label: "Gluten free", price: 5 }, { label: "Vegan", price: 5 }, { label: "Nut free" }],
      },
      { key: "message", type: "text", label: "Message on cake", maxLength: 30, placeholder: "Happy birthday!" },
      { key: "pickup", type: "date", label: "Pickup date", required: true },
    ],
  },
  {
    id: "personalized-print",
    name: "Personalized print",
    category: "Art & prints",
    description: "Frame, paper finish, names and an optional dedication.",
    tint: "#efedfb",
    fields: [
      {
        key: "frame",
        type: "swatch",
        label: "Frame",
        required: true,
        choices: [
          { label: "Black", color: "#1f1f1f" },
          { label: "White", color: "#f4f4f4" },
          { label: "Oak", color: "#c49a6c", price: 10 },
        ],
      },
      { key: "paper", type: "radio", label: "Paper", choices: [{ label: "Matte" }, { label: "Glossy" }] },
      { key: "names", type: "text", label: "Names", required: true, maxLength: 40, placeholder: "e.g. Sam & Jo" },
      { key: "dedicate", type: "checkbox", label: "Add a dedication" },
      {
        key: "dedication",
        type: "textarea",
        label: "Dedication",
        maxLength: 150,
        condition: { key: "dedicate", values: ["Yes"] },
      },
    ],
  },
  {
    id: "monogram-embroidery",
    name: "Monogram embroidery",
    category: "Clothing",
    description: "Thread color, initials, font and stitch placement.",
    tint: "#eef3f8",
    fields: [
      {
        key: "thread",
        type: "swatch",
        label: "Thread color",
        required: true,
        choices: [
          { label: "Navy", color: "#1f3a5f" },
          { label: "Gold", color: "#c9a227" },
          { label: "Blush", color: "#e8a5b3" },
        ],
      },
      { key: "initials", type: "text", label: "Initials", required: true, maxLength: 3, placeholder: "e.g. AJM" },
      {
        key: "font",
        type: "select",
        label: "Lettering",
        choices: [{ label: "Classic serif" }, { label: "Script" }, { label: "Block" }],
      },
      {
        key: "placement",
        type: "radio",
        label: "Placement",
        required: true,
        choices: [{ label: "Left chest" }, { label: "Center", price: 4 }, { label: "Sleeve", price: 6 }],
      },
    ],
  },
  {
    id: "pet-id-tag",
    name: "Pet ID tag",
    category: "Pets",
    description: "Tag shape, pet name, phone number and an engraved back.",
    tint: "#fff3df",
    fields: [
      {
        key: "shape",
        type: "radio",
        label: "Shape",
        required: true,
        choices: [{ label: "Bone" }, { label: "Round" }, { label: "Heart", price: 2 }],
      },
      { key: "name", type: "text", label: "Pet's name", required: true, maxLength: 12, placeholder: "e.g. Biscuit" },
      { key: "phone", type: "text", label: "Phone number", required: true, maxLength: 20 },
      { key: "back", type: "checkbox", label: "Engrave the back", price: 3 },
      {
        key: "backText",
        type: "text",
        label: "Back of tag",
        maxLength: 30,
        placeholder: "e.g. I'm microchipped",
        condition: { key: "back", values: ["Yes"] },
      },
    ],
  },
  {
    id: "flower-bouquet",
    name: "Flower bouquet",
    category: "Florist",
    description: "Stem count priced per stem, wrapping, a card and delivery date.",
    tint: "#fdeef2",
    fields: [
      { key: "stems", type: "number", label: "Number of stems", unit: "stem", min: 6, max: 48, required: true, price: 3 },
      {
        key: "wrap",
        type: "select",
        label: "Wrapping",
        choices: [{ label: "Kraft paper" }, { label: "Silk ribbon", price: 5 }, { label: "Hat box", price: 18 }],
      },
      { key: "card", type: "textarea", label: "Card message", maxLength: 150, placeholder: "We'll handwrite it" },
      { key: "date", type: "date", label: "Delivery date", required: true },
    ],
  },
  {
    id: "wedding-stationery",
    name: "Wedding stationery",
    category: "Stationery",
    description: "Names, date, foil color, paper stock and RSVP cards.",
    tint: "#f6f1ea",
    fields: [
      { key: "names", type: "text", label: "Couple's names", required: true, maxLength: 50, placeholder: "e.g. Ava & Leo" },
      { key: "date", type: "date", label: "Wedding date", required: true },
      {
        key: "foil",
        type: "swatch",
        label: "Foil",
        choices: [
          { label: "No foil", color: "#f4f4f4" },
          { label: "Gold foil", color: "#c9a227", price: 25 },
          { label: "Silver foil", color: "#b8bcc2", price: 25 },
        ],
      },
      {
        key: "paper",
        type: "radio",
        label: "Paper",
        required: true,
        choices: [{ label: "Smooth matte" }, { label: "Cotton", price: 15 }, { label: "Linen", price: 12 }],
      },
      { key: "rsvp", type: "checkbox", label: "Add RSVP cards", price: 30 },
    ],
  },
  {
    id: "scented-candle",
    name: "Scented candle",
    category: "Home",
    description: "Scent, wax color, a custom label and a gift box.",
    tint: "#f3efe9",
    fields: [
      {
        key: "scent",
        type: "select",
        label: "Scent",
        required: true,
        choices: [{ label: "Vanilla & oak" }, { label: "Fig & cedar" }, { label: "Sea salt" }, { label: "Lavender" }],
      },
      {
        key: "wax",
        type: "swatch",
        label: "Wax color",
        choices: [
          { label: "Ivory", color: "#f5efe1" },
          { label: "Blush", color: "#f1c6c6" },
          { label: "Sage", color: "#b7c9a8" },
        ],
      },
      { key: "label", type: "text", label: "Label message", maxLength: 24, placeholder: "e.g. Home sweet home", price: 4 },
      { key: "box", type: "checkbox", label: "Gift box", price: 5 },
    ],
  },
  {
    id: "engraved-watch",
    name: "Engraved watch",
    category: "Jewelry",
    description: "Strap upgrade, case-back engraving and a presentation box.",
    tint: "#ecf0f4",
    fields: [
      {
        key: "strap",
        type: "radio",
        label: "Strap",
        required: true,
        choices: [{ label: "Rubber" }, { label: "Leather", price: 15 }, { label: "Steel", price: 30 }],
      },
      { key: "engrave", type: "checkbox", label: "Engrave the case back", price: 12 },
      {
        key: "text",
        type: "text",
        label: "Engraving",
        required: true,
        maxLength: 25,
        placeholder: "e.g. To Dad, 1985",
        condition: { key: "engrave", values: ["Yes"] },
      },
      { key: "box", type: "checkbox", label: "Presentation box", price: 8 },
    ],
  },
];

export const findTemplate = (id) => TEMPLATES.find((t) => t.id === id);

// Full editor-shaped fields for a template, with fresh IDs.
export function templateFields(template) {
  const ids = new Map(template.fields.map((f) => [f.key, crypto.randomUUID()]));
  return template.fields.map(({ key, condition, choices, ...rest }) => {
    const field = {
      ...newField(rest.type),
      ...rest,
      id: ids.get(key),
      choices: (choices ?? []).map((c) => ({ price: null, ...c })),
      condition: condition ? { fieldId: ids.get(condition.key), values: condition.values } : null,
    };
    return { ...field, priced: hasPrices([field]) };
  });
}
