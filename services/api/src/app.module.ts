import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AuthGuard, ImpersonateGuard, RolesGuard } from './auth.guard';
import { KeyService } from './key.service';
import { WalletService } from './wallet.service';
import { AuditService, NotifyService, RateLimitService } from './support.service';
import { FileService } from './file.service';
import { TaskService } from './task.service';
import { InvokeService } from './invoke.service';
import { ModelService } from './model.service';
import { AgentService } from './agent.service';
import { AllExceptionsFilter, EnvelopeInterceptor } from './http';
import { IdentityController } from './identity.controller';
import { CatalogController } from './catalog.controller';
import { AdminController } from './admin.controller';
import { AgentController, FileController, HealthController, InvokeController, OpenController, StoreController } from './surface.controller';
import { StoreService } from './store.service';

@Module({
  controllers: [
    HealthController,
    IdentityController,
    CatalogController,
    InvokeController,
    FileController,
    AgentController,
    OpenController,
    StoreController,
    AdminController,
  ],
  providers: [
    PrismaService,
    RedisService,
    KeyService,
    WalletService,
    AuditService,
    NotifyService,
    RateLimitService,
    FileService,
    TaskService,
    InvokeService,
    ModelService,
    AgentService,
    StoreService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ImpersonateGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
