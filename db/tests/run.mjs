import { readFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';
import { checkFixtures } from './check-fixtures.mjs';
import { runSql } from './psql.mjs';

try {
  process.stdout.write(runSql(readFileSync(new URL('../verify.sql', import.meta.url), 'utf8')));
  checkFixtures();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
