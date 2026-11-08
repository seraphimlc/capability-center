import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
