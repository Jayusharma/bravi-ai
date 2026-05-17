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
                    systemInstruction: `You are a lead qualification AI for ${this.businessContext}. Your primary job is to CAPTURE business leads — never let a real business enquiry slip through. Classify every message that shows any commercial, product, pricing, or service interest as a lead. Only reject clear spam, promotions, OTPs, and auto-replies. Respond with ONLY valid JSON.`,
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
            console.log("ai failed  and throwed an error ")
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
        from: string;
        channel: string;
    }): string {
        return `You are analyzing a message received by a business on ${message.channel}.

FROM: ${message.from}
MESSAGE:
${message.body}

DECISION RULES (read carefully):

Mark isLead=true (confidence 75-95) when the message shows ANY of these signals:
- Asking about price, pricing, rates, quotation, quote, cost, charges
- Asking for samples, catalogue, brochure, product list, demo
- Asking about availability, stock, delivery, shipping, lead time
- Mentioning a quantity, bulk order, wholesale, retail requirement
- Asking how to buy, place an order, or make a purchase
- Asking about specifications, features, quality of a product or service
- Requesting a callback, meeting, or follow-up for business purposes
- Sending a business enquiry even if phrased informally (e.g. "send me pricing", "what is the rate")
- Hindi/Urdu/regional business messages about products or prices

Mark isLead=false (confidence 70-95) ONLY for clear non-business:
- Spam or promotional bulk messages
- Auto-replies and system notifications
- OTPs or verification codes
- Pure personal conversation with no business intent
- Unsubscribe or opt-out messages

For ambiguous short messages like just "hi" or "hello" with no context:
- isLead=false, confidence=60 (route to review so no message is lost)

NEVER mark a real pricing, product, or order request as NOT a lead. When in doubt, mark as lead.

Return JSON:
{
  "isLead": true or false,
  "confidence": 0 to 100,
  "intent": one of "PRODUCT_INQUIRY" | "PRICING_REQUEST" | "BULK_ORDER" | "SHIPPING_INQUIRY" | "GENERAL_INFO" | "COMPLAINT" | "APPOINTMENT" | "DOCUMENT_SUBMIT" | "RETURN_REFUND" | "PARTNERSHIP" | "UNKNOWN",
  "urgency": 1 to 5,
  "priority": 1 to 10,
  "reason": "one sentence explaining your classification decision",
  "extractedData": {
    "contactName": "name or null",
    "companyName": "company or null",
    "productRequested": "product or null",
    "quantitySignal": "quantity mentioned or null",
    "areaLocality": "location or null",
    "budgetSignal": "budget hints or null",
    "timelineSignal": "timeline mentions or null"
  },
  "detectedLanguage": "en" or "hi" or relevant ISO code
}`;
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
