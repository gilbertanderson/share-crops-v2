// @ts-nocheck
//
// Image storage backend selection.
//
// Default: Supabase Storage (unchanged) — `/upload` stores the file and returns
// a 1-year signed URL persisted on the listing/profile row. Those URLs expire,
// which is the long-standing gotcha called out in the app review.
//
// Opt-in: Netlify Blobs. When NETLIFY_BLOBS_SITE_ID + NETLIFY_BLOBS_TOKEN are
// set, uploads go to a Netlify Blob store and `/upload` returns a STABLE,
// same-origin serving URL (`…/images/<key>`) backed by the GET /images route.
// Stable URLs never expire, so nothing persisted in the DB goes stale.
//
// `getStore({ siteID, token })` lets @netlify/blobs talk to the Blobs API from
// any runtime (including this Vercel function) — it does not require running on
// Netlify. Netlify's Image CDN (`/.netlify/images`) is a separate, edge-served
// optimization that DOES require Netlify hosting; see docs/note in app.ts.
import { getStore } from "@netlify/blobs";
import { getEnv } from "./env.ts";

const IMAGE_STORE_NAME = "share-crops-images";

export const isBlobsConfigured = (): boolean =>
  Boolean(getEnv("NETLIFY_BLOBS_SITE_ID") && getEnv("NETLIFY_BLOBS_TOKEN"));

const imageStore = () =>
  getStore({
    name: IMAGE_STORE_NAME,
    siteID: getEnv("NETLIFY_BLOBS_SITE_ID")!,
    token: getEnv("NETLIFY_BLOBS_TOKEN")!,
    consistency: "strong",
  });

export const putImage = async (
  key: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<void> => {
  await imageStore().set(key, data, { metadata: { contentType } });
};

export interface StoredImage {
  data: ArrayBuffer;
  contentType: string;
}

export const getImage = async (key: string): Promise<StoredImage | null> => {
  const result = await imageStore().getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) return null;
  const contentType =
    (result.metadata?.contentType as string | undefined) || "application/octet-stream";
  return { data: result.data, contentType };
};

export const deleteImage = async (key: string): Promise<void> => {
  await imageStore().delete(key);
};
