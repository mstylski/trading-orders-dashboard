import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export function runSql(sql) {
  const options = process.argv.slice(2);
  if (options.some((option) => option !== '--docker')) {
    throw new Error('Usage: npm run test:db[:fixtures] -- [--docker]');
  }

  const docker = options.includes('--docker');
  const psqlArgs = ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-tA', '-f', '-'];
  const command = docker ? 'docker' : process.env.PSQL || 'psql';
  const args = docker
    ? [
        'compose',
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'trading',
        '-d',
        'trading_orders',
        ...psqlArgs,
      ]
    : psqlArgs;
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    input: sql,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '127.0.0.1',
      PGPORT: process.env.PGPORT ?? '5432',
      PGUSER: process.env.PGUSER ?? 'trading',
      PGDATABASE: process.env.PGDATABASE ?? 'trading_orders',
      PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? '10',
    },
  });

  if (result.error) {
    throw new Error(`Cannot run ${command}: ${result.error.message}`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`Database check failed (exit ${result.status ?? result.signal}).`);
  }
  return result.stdout;
}
