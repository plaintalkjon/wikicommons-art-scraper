import { supabase } from './supabaseClient';
import { DownloadedImage } from './types';
import { config } from './config';

export async function uploadToStorage(path: string, image: DownloadedImage): Promise<{ path: string; publicUrl: string }> {
  const { error } = await supabase.storage.from(config.supabaseBucket).upload(path, image.buffer, {
    contentType: image.mime,
    upsert: true,
  });
  if (error) {
    throw new Error(`Supabase upload failed for ${path}: ${error.message}`);
  }

  const { data } = supabase.storage.from(config.supabaseBucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

