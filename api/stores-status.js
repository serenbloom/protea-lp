// /api/stores-status.js
// Vercel Serverless Function: fetches the live STORES product page for PROTEA
// and returns a small, parsed JSON summary of price / stock per item.
// No external dependencies (plain regex parsing) so this deploys with
// zero build step on a static Vercel project.
//
// Response shape:
// {
//   "updatedAt": "2026-09-17T12:00:00.000Z",
//   "items": [
//     { "id": "...", "name": "...", "price": 7700, "soldOut": false }
//   ]
// }

const STORES_URL = "https://proteaoil.stores.jp/";

// Matches each <li id="..." ... class="...c-itemList__item...">...</li> block
const ITEM_BLOCK_RE =
  /<li id="([0-9a-f]+)"[^>]*class="([^"]*c-itemList__item[^"]*)"[^>]*>([\s\S]*?)<\/li>/g;
const NAME_RE = /class="c-itemList__item-name"[^>]*>\s*([^<]+?)\s*</;
const PRICE_RE = /class="c-itemList__item-price-number"[^>]*aria-label="([0-9,]+)円"/;

function parseItems(html) {
  const items = [];
  let match;
  while ((match = ITEM_BLOCK_RE.exec(html)) !== null) {
    const [, id, classAttr, inner] = match;
    const nameMatch = NAME_RE.exec(inner);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    const soldOut = /is-sold-out/.test(classAttr) || /c-itemList__item-sold/.test(inner);
    const priceMatch = PRICE_RE.exec(inner);
    const price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ""), 10) : null;
    items.push({ id, name, price, soldOut });
  }
  return items;
}

module.exports = async (req, res) => {
  // Cache at Vercel's edge for 30 min, serve stale for up to 2h while revalidating,
  // so we don't hit STORES on every single pageview.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=1800, stale-while-revalidate=7200"
  );
  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    const upstream = await fetch(STORES_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      },
    });
    if (!upstream.ok) {
      const bodySnippet = (await upstream.text()).slice(0, 300);
      throw new Error(
        `STORES responded ${upstream.status}: ${bodySnippet}`
      );
    }
    const html = await upstream.text();
    const items = parseItems(html);

    if (items.length === 0) {
      // Parsing likely broke because STORES changed their markup.
      // Return a 200 with an empty list rather than an error so the
      // client-side script can quietly fall back to the static prices
      // already written into the page.
      res.status(200).json({ updatedAt: new Date().toISOString(), items: [] });
      return;
    }

    res.status(200).json({ updatedAt: new Date().toISOString(), items });
  } catch (err) {
    res.status(200).json({
      updatedAt: new Date().toISOString(),
      items: [],
      error: String(err && err.message ? err.message : err),
    });
  }
};
