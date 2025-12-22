import { supabase } from './supabaseClient';
import { DownloadedImage } from './types';
import { config } from './config';

export async function uploadToStorage(
  path: string, 
  image: DownloadedImage
): Promise<{ path: string; publicUrl: string; bucket: string }> {
  // Always use Art bucket
  const bucket = config.supabaseBucket;
  const { error } = await supabase.storage.from(bucket).upload(path, image.buffer, {
    contentType: image.mime,
    upsert: true,
  });
  if (error) {
    throw new Error(`Supabase upload failed for ${path}: ${error.message}`);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl, bucket };
}

