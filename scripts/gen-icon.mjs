// Regenerate app/apple-icon.png (the iPhone "Add to Home Screen" icon) from the
// brand "RC" monogram. Run:  node scripts/gen-icon.mjs
//
// The 180×180 apple-touch-icon mirrors the browser-tab favicon (app/icon.svg):
// the "RC" monogram from the site header (R solid, C outlined, Anton display
// face), with no tile or frame. The letters are the real Anton glyph outlines
// baked to paths (no font dependency). Two differences from the favicon: it
// sits on a solid white tile (iOS masks it into a squircle and won't honor
// transparency), and it carries a little more padding so the squircle mask
// can't clip the letters at the corners. If you change the design here, mirror
// it in app/icon.svg too.
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../app/apple-icon.png", import.meta.url));

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#ffffff"/>
  <g transform="translate(13.379 155.590) scale(0.074534 -0.074534)">
    <!-- R — solid -->
    <path d="M78 0L78 1760L618 1760Q753 1760 822 1698.5Q891 1637 914.5 1526.5Q938 1416 938 1267Q938 1123 901.5 1037Q865 951 764 918Q847 901 880.5 835.5Q914 770 914 666L914 0L567 0L567 689Q567 766 535.5 784.5Q504 803 434 803L434 0ZM436 1108L521 1108Q594 1108 594 1267Q594 1370 578 1402Q562 1434 518 1434L436 1434Z" fill="#0a0a0a"/>
    <!-- C — outlined -->
    <path transform="translate(976 0)" d="M488 -16Q297 -16 180.5 103Q64 222 64 436L64 1248Q64 1504 165.5 1640Q267 1776 496 1776Q621 1776 718.5 1730Q816 1684 872 1592.5Q928 1501 928 1362L928 1058L578 1058L578 1318Q578 1397 558 1424.5Q538 1452 496 1452Q447 1452 430 1416.5Q413 1381 413 1322L413 441Q413 368 434.5 338Q456 308 496 308Q541 308 559.5 345Q578 382 578 441L578 758L932 758L932 425Q932 193 815 88.5Q698 -16 488 -16Z" fill="none" stroke="#0a0a0a" stroke-width="140" stroke-linejoin="round" stroke-linecap="round"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).resize(180, 180).png().toFile(out);
console.log("wrote", out);
