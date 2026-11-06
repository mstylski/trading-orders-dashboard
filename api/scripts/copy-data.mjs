import { cpSync } from 'node:fs';
import { URL } from 'node:url';

cpSync(new URL('../data/', import.meta.url), new URL('../../dist/api/data/', import.meta.url), {
  recursive: true,
});
