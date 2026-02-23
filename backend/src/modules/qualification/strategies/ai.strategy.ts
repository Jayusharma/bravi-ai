import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

// ═══════════════════════════════════════════════════════════════════
// AI Classification Result — what the AI returns after analyzing a message
// ═══════════════════════════════════════════════════════════════════

export interface AIClassificationResult {
    isLead: boolean;
    confidence: number;       // 0-100
    intent: string;           // e.g., PRODUCT_INQUIRY, PRICING_REQUEST
    urgency: number;          // 1-5
    priority: number;         // 1-10
    reason: string;           // Why the AI made this decision
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
// AI Classifier Strategy — Uses Google Gemini for lead qualification
//
// This is the ONLY qualification layer (no rule engine for now).
// Called by the qualification service for every new message that
// doesn't already have an open enquiry.
//
// FLOW:
//   1. Build a structured prompt with the message content
//   2. Send to Gemini with JSON-only response format
//   3. Parse the response, normalize intent
//   4. Return classification result
//   5. On failure → return NEEDS_REVIEW (safe fallback)
// ═══════════════════════════════════════════════════════════════════

@Injectable()
export class AIClassifierStrategy {
    private readonly logger = new Logger(AIClassifierStrategy.name);
    private client: GoogleGenAI;
    private businessContext: string;

    constructor(private config: ConfigService) {
        this.client = new GoogleGenAI({
            apiKey: this.config.getOrThrow('GOOGLE_API_KEY'),
        });

        this.businessContext = this.config.get(
            'QUALIFICATION_BUSINESS_CONTEXT',
            'a product-based company selling goods and services',
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // MAIN: Classify an inbound message
    // ═══════════════════════════════════════════════════════════════════

    async classify(message: {
        body: string;
        subject?: string | null;
        from: string;
        channel: string;
    }): Promise<AIClassificationResult> {
        const startTime = Date.now();

        try {
            const prompt = this.buildPrompt(message);

            const response = await this.client.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: `You are a lead qualification AI for ${this.businessContext}. Analyze incoming messages and determine if they are genuine business enquiries or spam/noise. You MUST respond with ONLY valid JSON — no markdown, no code blocks, no explanation text.`,
                    temperature: 0.1, // Low temperature for consistent, deterministic results
                    maxOutputTokens: 1024,
                },
            });

            // Extract text from response
            const rawText = response.text?.trim();

            if (!rawText) {
                throw new Error('Empty response from Gemini');
            }

            // Parse JSON — handle cases where AI wraps in ```json blocks
            const jsonText = this.extractJson(rawText);
            const parsed = JSON.parse(jsonText);

            // Extract token usage (Gemini format)
            const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
            const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

            const processingMs = Date.now() - startTime;
            this.logger.log(
                `🤖 AI classified in ${processingMs}ms | isLead: ${parsed.isLead} | confidence: ${parsed.confidence} | intent: ${parsed.intent} | tokens: ${inputTokens}+${outputTokens}`,
            );

            return {
                isLead: parsed.isLead ?? false,
                confidence: this.clamp(parsed.confidence ?? 50, 0, 100),
                intent: this.normalizeIntent(parsed.intent),
                urgency: this.clamp(parsed.urgency ?? 3, 1, 5),
                priority: this.clamp(parsed.priority ?? 5, 1, 10),
                reason: parsed.reason ?? 'AI classification complete',
                extractedData: {
                    contactName: parsed.extractedData?.contactName || undefined,
                    companyName: parsed.extractedData?.companyName || undefined,
                    productRequested: parsed.extractedData?.productRequested || undefined,
                    quantitySignal: parsed.extractedData?.quantitySignal || undefined,
                    areaLocality: parsed.extractedData?.areaLocality || undefined,
                    budgetSignal: parsed.extractedData?.budgetSignal || undefined,
                    timelineSignal: parsed.extractedData?.timelineSignal || undefined,
                },
                detectedLanguage: parsed.detectedLanguage ?? 'en',
                inputTokens,
                outputTokens,
            };
        } catch (error) {
            console.log("ai failded and throwed an error ")
            const processingMs = Date.now() - startTime;
            this.logger.error(
                `❌ AI classification failed after ${processingMs}ms: ${error.message}`,
            );

            // SAFE FALLBACK: If AI fails, send to manual review
            // Never auto-classify as SPAM or REAL if we're unsure
            return {
                isLead: false,
                confidence: 0,
                intent: 'UNKNOWN',
                urgency: 3,
                priority: 5,
                reason: `AI failed: ${error.message}. Sent to manual review.`,
                extractedData: {},
                detectedLanguage: 'unknown',
                inputTokens: 0,
                outputTokens: 0,
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PROMPT BUILDER
    // ═══════════════════════════════════════════════════════════════════

    private buildPrompt(message: {
        body: string;
        subject?: string | null;
        from: string;
        channel: string;
    }): string {
        return `Analyze this ${message.channel} message and determine if it's a genuine business enquiry.

FROM: ${message.from}
${message.subject ? `SUBJECT: ${message.subject}` : ''}
MESSAGE:
${message.body}

Respond with this exact JSON structure (no markdown, no code blocks):
{
  "isLead": true or false,
  "confidence": 0 to 100,
  "intent": "PRODUCT_INQUIRY" | "PRICING_REQUEST" | "BULK_ORDER" | "SHIPPING_INQUIRY" | "GENERAL_INFO" | "COMPLAINT" | "APPOINTMENT" | "DOCUMENT_SUBMIT" | "RETURN_REFUND" | "PARTNERSHIP" | "UNKNOWN",
  "urgency": 1 to 5,
  "priority": 1 to 10,
  "reason": "one sentence explaining your decision",
  "extractedData": {
    "contactName": "person's name if mentioned or null",
    "companyName": "company/business name if mentioned or null",
    "productRequested": "which product/item if mentioned or null",
    "quantitySignal": "any quantity or bulk indicators or null",
    "areaLocality": "area or location if mentioned or null",
    "budgetSignal": "any budget hints or null",
    "timelineSignal": "any urgency/timeline mentions or null"
  },
  "detectedLanguage": "en" or "hi" or relevant language code
}

Classification rules:
- isLead=true: person is genuinely enquiring about products, pricing, ordering, or business services
- isLead=false: spam, auto-reply, personal chat, marketing, promotional, OTP, notifications
- confidence below 50 means you're unsure — this triggers human review
- Be strict: only mark as lead if there's genuine purchase/business intent
- A casual greeting like "hi" or "how are you" is NOT a lead (isLead=false, confidence=80)
- Extract ANY useful data you can find in extractedData fields`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Extract JSON from AI response that might be wrapped in markdown code blocks.
     * Gemini sometimes returns ```json ... ``` despite instructions.
     */
    private extractJson(text: string): string {
        // Try to extract from ```json ... ``` block
        const jsonBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonBlockMatch) {
            return jsonBlockMatch[1].trim();
        }

        // Try to find JSON object directly
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return jsonMatch[0];
        }

        // Return as-is and let JSON.parse handle the error
        return text;
    }

    /**
     * Normalize the AI's intent string to match our EnquiryIntent enum.
     */
    private normalizeIntent(raw: string): string {
        const valid = [
            'PRODUCT_INQUIRY', 'PRICING_REQUEST', 'BULK_ORDER', 'SHIPPING_INQUIRY',
            'GENERAL_INFO', 'COMPLAINT', 'APPOINTMENT', 'DOCUMENT_SUBMIT',
            'RETURN_REFUND', 'PARTNERSHIP', 'UNKNOWN',
        ];
        const upper = (raw || '').toUpperCase().replace(/\s+/g, '_');
        return valid.includes(upper) ? upper : 'UNKNOWN';
    }

    /**
     * Clamp a number between min and max.
     */
    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }
}