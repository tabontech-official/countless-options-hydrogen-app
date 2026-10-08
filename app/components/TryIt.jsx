import { useState } from "react";
import { RingImage } from "./Art";

// Try-it product card: a working storefront preview, used on the dashboard and the landing page.

const METALS = [
  { name: "Yellow gold", color: "#c9a227" },
  { name: "White gold", color: "#c9ccd1" },
  { name: "Rose gold", color: "#d9a395" },
];
const SIZES = ["5", "6", "7", "8", "9"];
const BASE = 129;
const ENGRAVING = 10;
const GIFT_BOX = 5;
const usd = (n) => `$${n.toFixed(2)}`;

export function TryIt({ onAddToCart }) {
  const [metal, setMetal] = useState(METALS[0]);
  const [size, setSize] = useState("7");
  const [engrave, setEngrave] = useState(true);
  const [text, setText] = useState("Forever, Emma");
  const [gift, setGift] = useState(false);
  const total = BASE + (engrave ? ENGRAVING : 0) + (gift ? GIFT_BOX : 0);

  return (
    <div className="co-glass co-pdp" role="group" aria-label="Sample product page you can try">
      <div className="co-pdp__head">
        <span className="co-pdp__thumb">
          <RingImage />
        </span>
        <span>
          <strong>Eternity Ring</strong>
          <small>Sample product · live preview</small>
        </span>
      </div>

      <div className="co-pdp__label">
        <span>Metal</span>
        <span>{metal.name}</span>
      </div>
      <div className="co-metals">
        {METALS.map((m) => (
          <button
            key={m.name}
            type="button"
            aria-label={m.name}
            aria-pressed={metal === m}
            style={{ background: m.color }}
            onClick={() => setMetal(m)}
          />
        ))}
      </div>

      <div className="co-pdp__label">
        <span>Size</span>
      </div>
      <div className="co-sizes">
        {SIZES.map((s) => (
          <button key={s} type="button" aria-pressed={size === s} onClick={() => setSize(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="co-pdp__addons">
        <label className="co-checkrow">
          <input type="checkbox" checked={engrave} onChange={(e) => setEngrave(e.target.checked)} />
          Engraving
          <span className="co-mono co-up">+${ENGRAVING}</span>
        </label>
        {/* The follow-up: only shown while engraving is ticked. */}
        <div className="co-reveal" data-open={engrave}>
          <div>
            <span className="co-textfield">
              <input
                value={text}
                maxLength={20}
                aria-label="Engraving text"
                disabled={!engrave}
                onChange={(e) => setText(e.target.value)}
              />
              <small className="co-mono">{`${text.length}/20`}</small>
            </span>
          </div>
        </div>
        <label className="co-checkrow">
          <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
          Gift box
          <span className="co-mono co-up">+${GIFT_BOX}</span>
        </label>
      </div>

      <button
        type="button"
        className="co-addcart"
        aria-label={`Add to cart, ${usd(total)}, ${metal.name}, size ${size}`}
        onClick={onAddToCart}
      >
        <span>Add to cart</span>
        <span className="co-mono">{usd(total)}</span>
      </button>
    </div>
  );
}
