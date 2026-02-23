import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ReviewDecision {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export class ManualReviewDto {
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @IsOptional()
  @IsString()
  reason?: string;
}