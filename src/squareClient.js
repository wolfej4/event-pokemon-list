"use strict";
// Minimal Square Catalog API client — no SDK, just fetch (Node 20+ has
// fetch/FormData/Blob built in). Pushes a design's photo + description to
// Square as a catalog item with its price left at $0 so the price can be
// set/edited from Square itself afterward.

const SQUARE_VERSION = "2024-06-04";

function isConfigured() {
  return !!(process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_LOCATION_ID);
}

function getConfig() {
  if (!isConfigured()) {
    const err = new Error("Square is not configured (set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID)");
    err.isNotConfigured = true;
    throw err;
  }
  return {
    token: process.env.SQUARE_ACCESS_TOKEN,
    locationId: process.env.SQUARE_LOCATION_ID,
    base: process.env.SQUARE_ENVIRONMENT === "sandbox"
      ? "https://connect.squareupsandbox.com"
      : "https://connect.squareup.com"
  };
}

function idempotencyKey() {
  return "n3d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

async function squareFetch(path, options = {}) {
  const { token, base } = getConfig();
  const headers = Object.assign(
    {
      Authorization: "Bearer " + token,
      "Square-Version": SQUARE_VERSION
    },
    options.headers || {}
  );
  const res = await fetch(base + path, Object.assign({}, options, { headers }));

  let json = null;
  try { json = await res.json(); } catch (_) { /* no body */ }

  if (!res.ok) {
    const detail = json && Array.isArray(json.errors) && json.errors[0]
      ? json.errors[0].detail || json.errors[0].code
      : "Square request failed (" + res.status + ")";
    const err = new Error(detail);
    if (res.status === 401 || res.status === 403) err.isAuth = true;
    throw err;
  }
  return json || {};
}

function buildDescription(d) {
  const parts = [];
  if (d.pokemon && d.pokemon.description) parts.push(d.pokemon.description);
  if (d.pokemon && Array.isArray(d.pokemon.types) && d.pokemon.types.length) {
    parts.push("Type: " + d.pokemon.types.join(" / "));
  }
  if (d.print_time) parts.push("Print time: " + d.print_time);
  if (d.total_weight_grams != null) parts.push("Weight: " + d.total_weight_grams + "g");
  return parts.join("\n\n") || d.title;
}

/**
 * Create or update the Square catalog item + variation for a design, then
 * create/replace its catalog image if the design has a photo. Price is
 * always left at $0 — the idea is to get the listing (photo + description)
 * into Square and set the real price there.
 *
 * `design` is the raw db record (has square_item_id/square_variation_id/
 * square_image_id/square_image_url from a previous sync, if any).
 * Returns the fields to persist back onto the design.
 */
async function pushDesign(design) {
  const { locationId } = getConfig();

  let itemVersion, variationVersion;
  if (design.square_item_id) {
    const existing = await squareFetch("/v2/catalog/object/" + encodeURIComponent(design.square_item_id));
    itemVersion = existing.object.version;
    const existingVariation = design.square_variation_id
      ? existing.object.item_data.variations.find(v => v.id === design.square_variation_id)
      : null;
    if (existingVariation) variationVersion = existingVariation.version;
  }

  const itemVariation = {
    type: "ITEM_VARIATION",
    id: design.square_variation_id || "#variation",
    item_variation_data: {
      name: "Regular",
      pricing_type: "FIXED_PRICING",
      price_money: { amount: 0, currency: "USD" },
      track_inventory: false
    }
  };
  if (variationVersion !== undefined) itemVariation.version = variationVersion;

  const item = {
    type: "ITEM",
    id: design.square_item_id || "#item",
    item_data: {
      name: design.title,
      description: buildDescription(design),
      present_at_all_locations: false,
      present_at_location_ids: [locationId],
      variations: [itemVariation]
    }
  };
  if (itemVersion !== undefined) item.version = itemVersion;

  const upsertRes = await squareFetch("/v2/catalog/object", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idempotency_key: idempotencyKey(), object: item })
  });

  const savedItem = upsertRes.catalog_object;
  const itemId = savedItem.id;
  const variationId = savedItem.item_data.variations[0].id;

  const result = {
    square_item_id: itemId,
    square_variation_id: variationId,
    square_synced_at: new Date().toISOString()
  };

  if (design.image_url) {
    const needsImage = !design.square_image_id || design.square_image_url !== design.image_url;
    if (needsImage) {
      const imageId = await uploadImage({
        imageUrl: design.image_url,
        itemId,
        existingImageId: design.square_image_id,
        caption: design.title
      });
      result.square_image_id = imageId;
      result.square_image_url = design.image_url;
    }
  }

  return result;
}

async function uploadImage({ imageUrl, itemId, existingImageId, caption }) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error("Couldn't download design image to upload to Square");
  const blob = await imgRes.blob();

  const request = existingImageId
    ? { idempotency_key: idempotencyKey() }
    : {
        idempotency_key: idempotencyKey(),
        object_id: itemId,
        image: { type: "IMAGE", id: "#image", image_data: { caption } }
      };

  const form = new FormData();
  form.append("request", JSON.stringify(request));
  form.append("image_file", blob, "design.jpg");

  const path = existingImageId
    ? "/v2/catalog/images/" + encodeURIComponent(existingImageId)
    : "/v2/catalog/images";

  const res = await squareFetch(path, { method: "POST", body: form });
  return res.image.id;
}

module.exports = { isConfigured, pushDesign };
