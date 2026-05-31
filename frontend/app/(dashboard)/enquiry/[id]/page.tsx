import { notFound } from 'next/navigation';
import { getEnquiry } from '@/services/enquiry/enquiry.service';
import { getActiveDraft, getOutboundMessages } from '@/services/messaging/chat.service';
import { EnquiryDetailClient } from '@/components/enquiry/EnquiryDetailClient';

interface Props {
    params: Promise<{ id: string }>;
}

export default async function EnquiryDetailPage({ params }: Props) {
    const { id } = await params;

    const [enquiry, draft, outboundMessages] = await Promise.all([
        getEnquiry(id).catch(() => null),
        getActiveDraft(id).catch(() => null),
        getOutboundMessages(id).catch(() => ({ data: [], total: 0 })),
    ]);

    if (!enquiry) notFound();

    // Resolve primary outbound channel and recipient address for the composer
    const primaryChannel = enquiry.contact.channels.find((c) => c.isPrimary)
        ?? enquiry.contact.channels[0]
        ?? null;

    return (
        <EnquiryDetailClient
            enquiry={enquiry}
            initialDraft={draft}
            initialMessages={outboundMessages.data}
            recipientChannel={(primaryChannel?.channel as 'EMAIL' | 'WHATSAPP') ?? 'WHATSAPP'}
            recipientAddress={primaryChannel?.identifier ?? ''}
        />
    );
}
