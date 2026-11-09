// A real NestJS process: natural exit after app.close() proves that pool sockets
// and pending connection attempts do not keep the application alive.
import 'reflect-metadata';
import process from 'node:process';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../dist/api/src/app.module.js';

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
await app.listen(0, '127.0.0.1');
process.send({ type: 'ready', baseUrl: await app.getUrl() });

let closing = false;
process.on('message', async (message) => {
  if (message !== 'close' || closing) return;
  closing = true;
  try {
    await app.close();
    process.disconnect();
  } catch {
    process.exitCode = 1;
    process.disconnect();
  }
});
