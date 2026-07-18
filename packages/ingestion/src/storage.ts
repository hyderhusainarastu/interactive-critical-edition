import { createClient } from "@supabase/supabase-js";

/**
 * Shared Supabase Storage access — used by apps/web (upload) and
 * apps/worker (download for parsing). Server-only: relies on the
 * service_role key, never exposed to the browser.
 */

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function bucket() {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "documents";
}

export async function uploadDocumentFile(params: {
  path: string;
  data: Buffer;
  contentType: string;
}) {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(bucket())
    .upload(params.path, params.data, {
      contentType: params.contentType,
      upsert: false,
    });
  if (error) throw error;
}

export async function downloadDocumentFile(path: string): Promise<Buffer> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(bucket()).download(path);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

export async function deleteDocumentFile(path: string) {
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(bucket()).remove([path]);
  if (error) throw error;
}

/**
 * Short-lived signed URL for direct client-side fetch (the PDF reader
 * loads the file straight from Storage rather than proxying bytes
 * through a Next.js route). Ownership is checked by the caller before
 * this is ever issued — the URL itself grants access to anyone who has
 * it for the TTL window, same tradeoff as any signed URL.
 */
export async function getSignedDocumentUrl(
  path: string,
  expiresInSeconds = 600,
): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from(bucket())
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
