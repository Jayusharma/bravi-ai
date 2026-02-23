import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import {
  QualificationRule,
  RuleType,
  QualificationStatus,
  QualificationLayer,
} from '@prisma/client';

export interface RuleResult {
  status: QualificationStatus;
  layer: QualificationLayer;
  score: number;
  matchedKeywords: string[];
  reason: string;
}

@Injectable()
export class RuleEngineStrategy {
  private readonly logger = new Logger(RuleEngineStrategy.name);
  private rulesCache: QualificationRule[] = [];
  private lastCacheRefresh = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaService) {}





}