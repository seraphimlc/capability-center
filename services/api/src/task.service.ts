import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { WalletService } from './wallet.service';
import { FileService } from './file.service';
import { NotifyService } from './support.service';
import { asJson } from './support.service';
import { ApiException } from './errors';

@Injectable()
export class TaskService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly wallet: WalletService,
    private readonly files: FileService,
    private readonly notify: NotifyService,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = this.redis.client.duplicate();
    this.queue = new Queue('cc-tasks', { connection: this.redis.client.duplicate() });
    this.worker = new Worker('cc-tasks', async (job) => this.process(String(job.data.taskId)), {
      connection,
      concurrency: 2,
    });
    this.worker.on('failed', (job, error) => {
      console.error('task failed', job?.id, error.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async createAndEnqueue(input: {
    tenantId: string;
    userId: string;
    type: string;
    invokeId: string;
    payload: unknown;
  }): Promise<string> {
    const id = ulid();
    await this.prisma.asyncTask.create({
      data: {
        id,
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        status: 'queued',
        progress: 0,
        invokeId: input.invokeId,
        payload: asJson(input.payload),
      },
    });
    await this.enqueue(id);
    return id;
  }

  async enqueue(taskId: string): Promise<void> {
    if (!this.queue) {
      setTimeout(() => void this.process(taskId), 200);
      return;
    }
    await this.queue.add('run', { taskId }, { attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 200 });
  }

  async cancel(userId: string, taskId: string) {
    const task = await this.prisma.asyncTask.findFirst({ where: { id: taskId, userId } });
    if (!task) throw new ApiException('TASK_NOT_FOUND');
    if (!['pending', 'queued', 'running'].includes(task.status)) throw new ApiException('TASK_CANCEL_NOT_ALLOWED');
    await this.prisma.asyncTask.update({ where: { id: task.id }, data: { status: 'cancelled', errorCode: 'INVOKE_CANCELLED' } });
    if (task.invokeId) {
      await this.prisma.invokeRecord.updateMany({
        where: { id: task.invokeId, status: 'running' },
        data: { status: 'cancelled', errorCode: 'INVOKE_CANCELLED', finishedAt: new Date() },
      });
      await this.wallet.releaseByInvoke(task.invokeId);
    }
    return { id: task.id, status: 'cancelled' };
  }

  async process(taskId: string): Promise<void> {
    const task = await this.prisma.asyncTask.findUnique({ where: { id: taskId } });
    if (!task || ['cancelled', 'succeeded', 'failed'].includes(task.status)) return;
    await this.prisma.asyncTask.update({ where: { id: task.id }, data: { status: 'running', progress: 20 } });
    try {
      for (const progress of [45, 75]) {
        await sleep(1200);
        const fresh = await this.prisma.asyncTask.findUnique({ where: { id: task.id } });
        if (!fresh || fresh.status === 'cancelled') return;
        await this.prisma.asyncTask.update({ where: { id: task.id }, data: { progress } });
      }
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="100%" height="100%" fill="#1f4d3a"/><text x="48" y="250" fill="#f4f0e6" font-size="36" font-family="sans-serif">能力中心 · 演示成片</text><text x="48" y="310" fill="#e7d7c3" font-size="20" font-family="sans-serif">异步任务已完成，积分在成功后扣减</text></svg>`,
      );
      const fileId = await this.files.putGenerated({
        userId: task.userId,
        tenantId: task.tenantId,
        filename: 'demo-video.svg',
        mime: 'image/svg+xml',
        body: svg,
      });
      const result = { summary: '演示视频已生成，可在文件中心查看分镜封面。', file_id: fileId, kind: task.type };
      let credits = 0;
      if (task.invokeId) {
        const captured = await this.wallet.captureByInvoke(task.invokeId);
        const invoke = await this.prisma.invokeRecord.findUnique({ where: { id: task.invokeId } });
        if (invoke?.status === 'cancelled' || !captured.captured) {
          await this.prisma.asyncTask.update({
            where: { id: task.id },
            data: { status: 'cancelled', errorCode: 'INVOKE_CANCELLED' },
          });
          return;
        }
        credits = captured.amount;
        await this.prisma.invokeRecord.update({
          where: { id: task.invokeId },
          data: {
            status: 'success',
            outputJson: asJson(result),
            credits,
            finishedAt: new Date(),
          },
        });
        if (invoke?.conversationId) {
          await this.prisma.message.create({
            data: {
              id: ulid(),
              conversationId: invoke.conversationId,
              role: 'notice',
              content: '异步任务已完成，结果已回写。',
              status: 'complete',
              toolCallJson: asJson({ task_id: task.id, file_id: fileId, invoke_id: task.invokeId }),
            },
          });
        }
      }
      await this.prisma.asyncTask.update({
        where: { id: task.id },
        data: { status: 'succeeded', progress: 100, result: asJson(result) },
      });
      await this.notify.push(task.userId, '任务已完成', result.summary);
    } catch (error) {
      if (task.invokeId) {
        await this.wallet.releaseByInvoke(task.invokeId);
        await this.prisma.invokeRecord.updateMany({
          where: { id: task.invokeId, status: 'running' },
          data: { status: 'failed', errorCode: 'TASK_FAILED', finishedAt: new Date() },
        });
      }
      await this.prisma.asyncTask.update({
        where: { id: task.id },
        data: { status: 'failed', errorCode: 'TASK_FAILED' },
      });
      await this.notify.push(task.userId, '任务失败', '异步任务没有完成，未扣减积分。');
      console.error('task process', error instanceof Error ? error.message : 'error');
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
