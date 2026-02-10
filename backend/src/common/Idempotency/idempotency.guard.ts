import { BadRequestException, CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from 'src/database/prisma.service';

@Injectable()
export class IdempotencyGuard implements CanActivate {
    constructor(private prisma:PrismaService){}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const key = request.headers['x-idempotency-key'];

    
        if(!key){
           
            return true;
        }

        const bodyhash = createHash('sha256').update(JSON.stringify(request.body)).digest('hex');

        const record = await this.prisma.idempotencyKey.findUnique({
            where: { key }
        });
  
        if(!record){
            await this.prisma.idempotencyKey.create({
                data: {
                    key,
                    requestHash: bodyhash,
                    status: 'PROCESSING',
                }
            });
            return true;
        }


        if (record.requestHash !== bodyhash) {
            throw new BadRequestException(
              'Idempotency key reused with different payload',
            );
          }

          const age = Date.now() - record.createdAt.getTime();
          if (record.status === 'PROCESSING' && age > 2 * 60 * 1000) {
            return true;
          }

        if(record.status === 'COMPLETED'){
            throw new ConflictException(record.response);
        }


     throw new ConflictException('Request already in progress');
}
}