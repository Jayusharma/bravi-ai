import { Module } from '@nestjs/common';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';

/**
 * TemplateModule — owns MessageTemplate / TemplateVariable CRUD, the variable engine,
 * and render(). In Step 3 it exports a real ITemplateService implementation that the
 * outbound module binds to TEMPLATE_SERVICE (replacing TemplateStubService).
 */
@Module({
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
