// Hand-drawn SVG artwork for the app: the sample ring product.
// Kept as inline SVG so it scales crisply and needs no image hosting.

// Product photo for the hero card: a gold ring with a stone, softly lit.
export function RingImage() {
  return (
    <svg viewBox="0 0 160 160" width="100%" aria-hidden="true">
      <ellipse cx="80" cy="132" rx="44" ry="7" fill="#1f1640" opacity="0.08" />
      <circle cx="80" cy="88" r="38" fill="none" stroke="#d4af37" strokeWidth="11" />
      <circle cx="80" cy="88" r="38" fill="none" stroke="#f6e3a1" strokeWidth="2.5" strokeDasharray="40 200" strokeDashoffset="-150" />
      <path d="M64 50 80 30l16 20-16 17Z" fill="#eef4fd" stroke="#9db4d3" strokeWidth="2" />
      <path d="M72 46 80 36l8 10" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.9" />
    </svg>
  );
}


