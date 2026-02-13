import { Global, Module } from '@nestjs/common';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { PermissionGuard } from './permission.guard';

@Global()
@Module({
    controllers: [PermissionController],
    providers: [PermissionService, PermissionGuard],
    exports: [PermissionService, PermissionGuard],
})
export class PermissionModule { }
