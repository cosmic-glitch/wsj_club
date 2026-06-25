// Regenerate app/apple-icon.png (the iPhone "Add to Home Screen" icon) from the
// open-book design. Run:  node scripts/gen-icon.mjs
//
// The 180×180 apple-touch-icon is full-bleed (no own rounded corners — iOS
// applies its own squircle mask). The browser-tab favicon (app/icon.svg) is the
// same artwork but with rounded corners; if you change the design here, mirror
// it there too.
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../app/apple-icon.png", import.meta.url));

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="180" y2="180" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f59e0b"/>
      <stop offset="0.5" stop-color="#f43f5e"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="180" height="180" fill="url(#tile)"/>
  <!-- soft drop shadow under the book -->
  <g fill="#1e1b3a" opacity="0.18">
    <path d="M84 60 L28 51 L28 124 L84 134 Z"/>
    <path d="M96 60 L152 51 L152 124 L96 134 Z"/>
  </g>
  <!-- open book: two cream pages, the gutter reveals the gradient as a colorful spine -->
  <g transform="translate(0,-3)">
    <path d="M84 58 L28 49 L28 122 L84 132 Z" fill="#fdfbf6"/>
    <path d="M96 58 L152 49 L152 122 L96 132 Z" fill="#fdfbf6"/>
    <g stroke="#cbd5e1" stroke-width="5" stroke-linecap="round">
      <line x1="44" y1="73" x2="76" y2="78"/>
      <line x1="44" y1="89" x2="76" y2="94"/>
      <line x1="44" y1="105" x2="76" y2="110"/>
      <line x1="104" y1="78" x2="136" y2="73"/>
      <line x1="104" y1="94" x2="136" y2="89"/>
      <line x1="104" y1="110" x2="136" y2="105"/>
    </g>
    <!-- bookmark ribbon tucked into the right page near the spine -->
    <path d="M110 47 L125 47 L125 92 L117.5 81 L110 92 Z" fill="#10b981"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(out);
console.log("wrote", out);
