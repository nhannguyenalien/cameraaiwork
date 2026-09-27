import { createRequire } from 'node:module';
import { statements } from '../apps/pages/migrations/002-offline-events.mjs';
const require = createRequire(new URL('../apps/pages/package.json', import.meta.url));
const { neon } = require('@neondatabase/serverless');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const sql = neon(process.env.DATABASE_URL);
await sql.transaction(tx => statements.map(statement => tx.query(statement)));
console.log('Offline event migration applied.');
