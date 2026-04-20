import fs from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env.production.local', override: true });

const { runMistralIngestionExtraction } = await import('../src/lib/ocr/mistral-extraction');

const filePath = path.join(process.cwd(), 'Profile screenshot ', 'IMG_7302.jpg');
const buffer = await fs.readFile(filePath);

const result = await runMistralIngestionExtraction({
  image: {
    base64: buffer.toString('base64'),
    mimeType: 'image/jpeg',
  },
  archetypeHint: 'governor_profile',
});

console.log(JSON.stringify(result, null, 2));
