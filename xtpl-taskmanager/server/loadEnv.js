import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Always load server/.env, even when `npm run dev` is started from the repo root.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });
