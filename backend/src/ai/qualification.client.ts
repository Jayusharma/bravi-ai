import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════
// AI Classification Result — the wire contract returned by the Python
// brain's /qualify endpoint. The brain serializes camelCase so this
// maps 1:1 with no field translation.
// ═══════════════════════════════════════════════════════════════════

export interface AIClassificationResult {
  isLead: boolean;
  confidence: number; // 0-100
  intent: string; // e.g. PRODUCT_INQUIRY, PRICING_REQUEST
  urgency: number; // 1-5
  priority: number; // 1-10
  reason: string;
  extractedData: {
    contactName?: string;
    companyName?: string;
    productRequested?: string;
    quantitySignal?: string;
    areaLocality?: string;
    budgetSignal?: string;
    timelineSignal?: string;
  };
  detectedLanguage: string;
  inputTokens: number;
  outputTokens: number;
}

// ═══════════════════════════════════════════════════════════════════
// QualificationAIClient — the backend's gateway to the Python brain for
// lead qualification. It only knows HTTP transport; all classification
// logic lives in the Python service. The qualification module owns the
// business logic and calls classify() here.
//
// On ANY failure (brain down, timeout, bad response) it returns a
// confidence:0 result, which QualificationService routes to NEEDS_REVIEW
// so a message is never lost.
// ═══════════════════════════════════════════════════════════════════

@Injectable()
export class QualificationAIClient {
  private readonly logger = new Logger(QualificationAIClient.name);
  private readonly AI_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';

  constructor(private readonly http: HttpService) {}

  async classify(message: {
    body: string;
    from: string;
    channel: string;
  }): Promise<AIClassificationResult> {
    try {
      const response = await firstValueFrom(
        this.http.post<AIClassificationResult>(
          `${this.AI_URL}/qualify`,
          {
            body: message.body,
            from: message.from,
            channel: message.channel,
          },
          {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Qualification AI call failed: ${error?.message}. Routing to manual review.`,
      );
      return this.safeFallback(error?.message ?? 'unknown error');
    }
  }

  // SAFE FALLBACK: confidence 0 → QualificationService marks NEEDS_REVIEW.
  private safeFallback(reason: string): AIClassificationResult {
    return {
      isLead: false,
      confidence: 0,
      intent: 'UNKNOWN',
      urgency: 3,
      priority: 5,
      reason: `AI service unreachable: ${reason}. Sent to manual review.`,
      extractedData: {},
      detectedLanguage: 'unknown',
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}
