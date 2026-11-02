import { createRequire } from 'node:module';
import { statements } from '../apps/pages/migrations/001-network-transfer.mjs';
const require = createRequire(new URL('../apps/pages/package.json', import.meta.url));
const postgres = require('postgres');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await sql.begin(tx => statements.map(statement => tx.unsafe(statement)));
await sql.end();
console.log('Network transfer migration applied atomically. Existing embeddings retained.');
