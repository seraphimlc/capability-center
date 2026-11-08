import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ulid } from 'ulid';
import { PrismaService } from './prisma.service';
import { ApiException } from './errors';
import { canHold } from './domain';

type Tx = Prisma.TransactionClient;

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async ensure(userId: string, tenantId: string) {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.wallet.create({
      data: { id: ulid(), userId, tenantId, balance: 0, status: 'active' },
    });
  }

  async snapshot(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new ApiException('NOT_FOUND', '钱包不存在');
    const held = await this.openHeld(wallet.id);
    return {
      balance: wallet.balance,
      held,
      available: wallet.balance - held,
      status: wallet.status,
      currency: 'CNY',
    };
  }

  async openHeld(walletId: string): Promise<number> {
    const agg = await this.prisma.creditHold.aggregate({
      where: { walletId, status: 'open' },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  async preview(userId: string, cost: number): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new ApiException('NOT_FOUND', '钱包不存在');
    if (wallet.status !== 'active') throw new ApiException('WALLET_FROZEN');
    const held = await this.openHeld(wallet.id);
    if (!canHold(wallet.balance, held, cost)) {
      throw new ApiException('INSUFFICIENT_CREDITS', undefined, {
        balance: wallet.balance - held,
        required: cost,
      });
    }
  }

  async hold(userId: string, invokeId: string, amount: number): Promise<string> {
    if (amount <= 0) return '';
    return this.prisma.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, userId);
      if (wallet.status !== 'active') throw new ApiException('WALLET_FROZEN');
      const held = await openHeldTx(tx, wallet.id);
      if (!canHold(wallet.balance, held, amount)) {
        throw new ApiException('INSUFFICIENT_CREDITS', undefined, {
          balance: wallet.balance - held,
          required: amount,
        });
      }
      const id = ulid();
      await tx.creditHold.create({
        data: {
          id,
          walletId: wallet.id,
          userId,
          tenantId: wallet.tenant_id,
          invokeId,
          amount,
          status: 'open',
        },
      });
      return id;
    });
  }

  async captureByInvoke(invokeId: string, requestId?: string): Promise<{ captured: boolean; amount: number; balance: number }> {
    return this.prisma.$transaction(async (tx) => {
      const holds = await tx.$queryRaw<HoldRow[]>`
        SELECT id, wallet_id, user_id, tenant_id, invoke_id, amount, status
        FROM credit_holds WHERE invoke_id = ${invokeId} FOR UPDATE`;
      const hold = holds[0];
      if (!hold || hold.status !== 'open') return { captured: false, amount: 0, balance: 0 };
      const invokeRows = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM invoke_records WHERE id = ${invokeId} FOR UPDATE`;
      if (invokeRows[0]?.status === 'cancelled') return { captured: false, amount: 0, balance: 0 };
      const wallet = await lockWallet(tx, hold.user_id);
      if (wallet.balance < hold.amount) throw new ApiException('INSUFFICIENT_CREDITS');
      const balance = wallet.balance - hold.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
      await tx.creditHold.update({ where: { id: hold.id }, data: { status: 'captured' } });
      await tx.ledgerEntry.create({
        data: {
          id: ulid(),
          walletId: wallet.id,
          userId: hold.user_id,
          tenantId: hold.tenant_id,
          type: 'consume',
          amount: -hold.amount,
          balanceAfter: balance,
          bizType: 'invoke',
          bizId: invokeId,
          note: '调用成功扣减',
          requestId: requestId ?? null,
        },
      });
      return { captured: true, amount: hold.amount, balance };
    });
  }

  async releaseByInvoke(invokeId: string): Promise<void> {
    await this.prisma.creditHold.updateMany({
      where: { invokeId, status: 'open' },
      data: { status: 'released' },
    });
  }

  async grant(input: {
    userId: string;
    amount: number;
    note: string;
    bizId: string;
    actorId: string;
    requestId?: string;
  }) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new ApiException('VALIDATION_ERROR', '充值数额必须是正整数');
    }
    return this.prisma.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, input.userId);
      if (wallet.status !== 'active') throw new ApiException('WALLET_FROZEN');
      const balance = wallet.balance + input.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
      const entry = await tx.ledgerEntry.create({
        data: {
          id: ulid(),
          walletId: wallet.id,
          userId: input.userId,
          tenantId: wallet.tenant_id,
          type: 'grant',
          amount: input.amount,
          balanceAfter: balance,
          bizType: 'grant',
          bizId: input.bizId,
          note: input.note.slice(0, 500),
          requestId: input.requestId ?? null,
        },
      });
      return { balance, entry_id: entry.id, amount: input.amount };
    });
  }

  async adjust(input: { userId: string; amount: number; note: string; bizId: string; requestId?: string }) {
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      throw new ApiException('VALIDATION_ERROR', '调账数额必须是非零整数');
    }
    return this.prisma.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, input.userId);
      const balance = wallet.balance + input.amount;
      if (balance < 0) throw new ApiException('ADJUSTMENT_NOT_ALLOWED');
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance } });
      const entry = await tx.ledgerEntry.create({
        data: {
          id: ulid(),
          walletId: wallet.id,
          userId: input.userId,
          tenantId: wallet.tenant_id,
          type: input.amount > 0 ? 'adjust' : 'adjust',
          amount: input.amount,
          balanceAfter: balance,
          bizType: 'adjust',
          bizId: input.bizId,
          note: input.note.slice(0, 500),
          requestId: input.requestId ?? null,
        },
      });
      return { balance, entry_id: entry.id };
    });
  }

  async refund(input: { userId: string; amount: number; note: string; bizId: string; requestId?: string }) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new ApiException('VALIDATION_ERROR', '退款数额必须是正整数');
    }
    return this.grant({ ...input, actorId: 'system' }).then(async (result) => {
      await this.prisma.ledgerEntry.update({
        where: { id: result.entry_id },
        data: { type: 'refund', bizType: 'refund' },
      });
      return result;
    });
  }
}

type WalletRow = { id: string; balance: number; status: string; tenant_id: string; user_id: string };
type HoldRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  tenant_id: string;
  invoke_id: string;
  amount: number;
  status: string;
};

async function lockWallet(tx: Tx, userId: string): Promise<WalletRow> {
  const rows = await tx.$queryRaw<WalletRow[]>`
    SELECT id, balance, status, tenant_id, user_id FROM wallets WHERE user_id = ${userId} FOR UPDATE`;
  const wallet = rows[0];
  if (!wallet) throw new ApiException('NOT_FOUND', '钱包不存在');
  return wallet;
}

async function openHeldTx(tx: Tx, walletId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT COALESCE(SUM(amount), 0) AS total FROM credit_holds WHERE wallet_id = ${walletId} AND status = 'open'`;
  return Number(rows[0]?.total ?? 0);
}
