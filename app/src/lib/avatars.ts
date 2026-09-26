import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const BUCKET = 'avatars';
/** Same as the bucket's limit (supabase/config.toml). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Photos are stored as a square this many pixels wide: sharp at any size the app draws them. */
const STORED_SIZE = 256;

/** The photo to show for a profile: the uploaded one, else the Google one, else none. */
export function photoUrl(profile: { avatar_path: string | null; google_avatar_url: string | null }): string | null {
  if (profile.avatar_path) return supabase.storage.from(BUCKET).getPublicUrl(profile.avatar_path).data.publicUrl;
  return profile.google_avatar_url;
}

/**
 * Lets the person pick a photo, shrinks it to a small square JPEG (on the web; phones upload it
 * as picked), stores it in their folder and points their profile at it. Returns an error
 * message, or null when saved. Picking nothing is not an error.
 */
export async function uploadPhoto(userId: string): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  const size = asset.fileSize ?? asset.file?.size ?? 0;
  if (size > MAX_PHOTO_BYTES) return 'That photo is over 5 MB. Try a smaller one.';

  let body: Blob;
  let contentType = 'image/jpeg';
  try {
    if (Platform.OS === 'web') {
      body = await squareJpeg(asset.uri, STORED_SIZE);
    } else {
      body = await (await fetch(asset.uri)).blob();
      contentType = asset.mimeType ?? 'image/jpeg';
    }
  } catch {
    return "Couldn't read that photo. Try another one.";
  }

  // A new name each time, so browsers never show a cached old photo.
  const path = `${userId}/${Date.now()}.${contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'}`;
  const upload = await supabase.storage.from(BUCKET).upload(path, body, { contentType });
  if (upload.error) return upload.error.message;
  const saved = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
  if (saved.error) return saved.error.message;
  await removeOthers(userId, path);
  return null;
}

/** Goes back to the Google photo (or the initial): clears the upload and deletes its file. */
export async function removePhoto(userId: string): Promise<string | null> {
  const saved = await supabase.from('profiles').update({ avatar_path: null }).eq('id', userId);
  if (saved.error) return saved.error.message;
  await removeOthers(userId, null);
  return null;
}

/** Deletes the person's stored photos except `keep`. Best effort: a leftover file is harmless. */
async function removeOthers(userId: string, keep: string | null) {
  const { data } = await supabase.storage.from(BUCKET).list(userId);
  const stale = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (stale.length) await supabase.storage.from(BUCKET).remove(stale);
}

/** The middle square of an image, scaled to `size` pixels, as a JPEG (web only: uses a canvas). */
async function squareJpeg(uri: string, size: number): Promise<Blob> {
  const image = new window.Image();
  image.src = uri;
  await image.decode();
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext('2d')!
    .drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85));
}
