export interface SendGridInboundPayload {
  from: string;
  to: string;
  subject?: string;
  text: string;
  html: string;
  headers: string;
  envelope: string;
}
