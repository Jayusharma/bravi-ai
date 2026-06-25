import { Injectable , Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

export interface AIDecision {
    action : string 
    draft : string | null
    reasoning : string 
    confidence : number
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
}
