import { Controller, Post, Body } from '@nestjs/common'
import { AIService } from './ai.service'

@Controller('ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  @Post('test')
  async test(@Body() body: { conversationId: string; businessId: string }) {
    const decision = await this.aiService.getDecision(
      body.conversationId,
      body.businessId,
      'no_reply_60min'
    )

    if (!decision) {
      return { status: 'AI service unavailable — null returned gracefully' }
    }

    return { status: 'success', decision }
  }
}