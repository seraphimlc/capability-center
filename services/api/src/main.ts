import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ulid } from 'ulid';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({ origin: true, credentials: true });
  app.use((req: { header: (name: string) => string | undefined; requestId?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.length <= 64 ? incoming : ulid();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  const port = Number(process.env.PORT || 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`capability-center api listening on ${port}`);
}

void bootstrap();
