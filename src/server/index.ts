/** Process entry point: load configuration, open the database, serve. */

import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { Store } from './db/index.js';
import { createProviders } from './services/llm/index.js';

const port = Number(process.env.PORT ?? 4000);
const dbFile = process.env.GRADESENSE_DB ?? resolve('data/gradesense.db');

let providers;
try {
  providers = createProviders(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// In production the built client is served from the same origin; in
// development Vite serves it and proxies /api here.
const clientDir = resolve('dist/client');
const store = new Store(dbFile);
const app = createApp({
  store,
  providers,
  clientDir: existsSync(clientDir) ? clientDir : null,
});

const server = app.listen(port, () => {
  console.log(`GradeSense API on http://localhost:${port}`);
  console.log(`  grading provider : ${providers.primary.name} (${providers.primary.model})`);
  console.log(`  fallback         : ${providers.fallback?.name ?? 'none'}`);
  console.log(`  database         : ${dbFile}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
