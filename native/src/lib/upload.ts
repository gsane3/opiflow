// Native manual photo upload — the technician attaches a photo (camera or
// library) straight onto a customer's files, mirroring the web authenticated
// upload flow exactly:
//   1) POST /api/customers/[id]/files/upload-url  → signed Supabase upload URL
//   2) supabase.storage.uploadToSignedUrl(path, token, bytes)  (direct to storage)
//   3) POST /api/customers/[id]/files/complete     → records file + timeline row
// Images only for now (the backend also allows mp4/quicktime; video upload can
// follow once we add a file-system reader for large blobs).

import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';

import { apiPost } from './api';
import { supabase } from './supabase';

const UPLOAD_BUCKET = 'customer-uploads';
const SELECTION_LIMIT = 8;

type SignedUpload = {
  ok?: boolean;
  uploadUrl?: string;
  uploadPath?: string;
  token?: string;
  uploadTokenId?: string;
  error?: string;
};

export type UploadResult = { ok: true; count: number } | { ok: false; error: string };

const CANCELED: UploadResult = { ok: false, error: 'canceled' };

export async function pickAndUploadPhotos(
  customerId: string,
  source: 'camera' | 'library',
): Promise<UploadResult> {
  // Permissions — the OS prompt only appears the first time.
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return { ok: false, error: 'Δεν δόθηκε άδεια κάμερας.' };
  } else {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return { ok: false, error: 'Δεν δόθηκε άδεια στη συλλογή.' };
  }

  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.6,
          base64: true,
          allowsMultipleSelection: true,
          selectionLimit: SELECTION_LIMIT,
        });

  if (picked.canceled || picked.assets.length === 0) return CANCELED;

  let uploadTokenId: string | undefined;
  const recorded: Array<{ path: string; name: string; sizeBytes: number; mimeType: string }> = [];

  for (let i = 0; i < picked.assets.length; i++) {
    const a = picked.assets[i];
    if (!a.base64) continue;
    const mimeType = a.mimeType ?? 'image/jpeg';
    const filename = a.fileName ?? `photo-${i + 1}.jpg`;
    const bytes = decode(a.base64);
    const sizeBytes = a.fileSize ?? bytes.byteLength;

    // Reuse the same upload-token row across the whole batch.
    const signed = await apiPost<SignedUpload>(`/api/customers/${customerId}/files/upload-url`, {
      filename,
      mimeType,
      sizeBytes,
      uploadTokenId,
    });
    if (!signed?.ok || !signed.uploadPath || !signed.token) {
      return { ok: false, error: signed?.error ?? 'Αποτυχία προετοιμασίας ανεβάσματος.' };
    }
    uploadTokenId = signed.uploadTokenId;

    const { error: upErr } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .uploadToSignedUrl(signed.uploadPath, signed.token, bytes, { contentType: mimeType, upsert: false });
    if (upErr) return { ok: false, error: 'Αποτυχία ανεβάσματος αρχείου.' };

    recorded.push({ path: signed.uploadPath, name: filename, sizeBytes, mimeType });
  }

  if (!uploadTokenId || recorded.length === 0) return CANCELED;

  const done = await apiPost<{ ok?: boolean; error?: string }>(`/api/customers/${customerId}/files/complete`, {
    uploadTokenId,
    files: recorded,
  });
  if (!done?.ok) return { ok: false, error: done?.error ?? 'Αποτυχία ολοκλήρωσης.' };
  return { ok: true, count: recorded.length };
}
