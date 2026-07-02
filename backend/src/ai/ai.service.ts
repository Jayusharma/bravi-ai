import { Injectable , Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

export interface AIDecision {
    action : string
    draft : string | null
    reasoning : string
    confidence : number
}

export interface AIReply {
    action : 'send' | 'escalate'
    reply : string | null
    subject : string | null
    confidence : number   // 0.0 - 1.0
    reasoning : string
}

@Injectable()
export class AIService{
    private readonly logger = new Logger(AIService.name)
    private readonly AI_URL= process.env.AI_SERVICE_URL ?? "http://localhost:8000"

    constructor(private readonly http: HttpService){}

    async getDecision(
        conversationID:string,
        businessID:string,
        trigger:string
    ): Promise<AIDecision | null>{
        try {

            const payload = {
                conversation_id : conversationID,
                business_id : businessID,
                trigger : trigger
            }
        
            const response = await firstValueFrom(
                this.http.post<AIDecision>(
                    `${this.AI_URL}/decide`,
                    payload,
                    {
                        timeout: 15000,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            )
            return response.data;
            
        } catch (error) {
            this.logger.error('Failed to get AI decision:', error);
            return null;
        }
    }

    async getReply(
        enquiryID: string,
        channel: string,
    ): Promise<AIReply | null> {
        try {
            const payload = {
                enquiry_id: enquiryID,
                channel: channel,
            }

            const response = await firstValueFrom(
                this.http.post<AIReply>(
                    `${this.AI_URL}/reply`,
                    payload,
                    {
                        timeout: 15000,
                        headers: { 'Content-Type': 'application/json' },
                    }
                )
            )
            return response.data;

        } catch (error) {
            this.logger.error('Failed to get AI reply:', error);
            return null;
        }
    }
}
