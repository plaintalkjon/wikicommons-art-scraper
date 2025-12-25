import path from 'path';
import dotenv from 'dotenv';

// Load .env from project root explicitly to work when executed from dist/
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_BUCKET'] as const;

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  supabaseBucket: process.env.SUPABASE_BUCKET!,
  targetWidth: 1280,
  // Wikimedia OAuth (optional - for higher rate limits)
  wikimediaClientId: process.env.WIKIMEDIA_CLIENT_ID,
  wikimediaClientSecret: process.env.WIKIMEDIA_CLIENT_SECRET,
};

