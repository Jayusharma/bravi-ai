import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SendMessageDto {
  /** Text body of the message. (Attachments + enquiry cards arrive in later steps.) */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  content: string;
}
