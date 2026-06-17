'use client';

import { Badge } from '@/components/ui/Badge';
import type { Template, WaApprovalStatus } from '@/services/template';

interface BadgeStyle {
    variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
    label: string;
}

const STATUS_STYLES: Record<WaApprovalStatus, BadgeStyle> = {
    DRAFT: { variant: 'secondary', label: 'Draft' },
    PENDING: { variant: 'warning', label: 'Pending review' },
    APPROVED: { variant: 'success', label: 'Approved' },
    REJECTED: { variant: 'destructive', label: 'Rejected' },
    PAUSED: { variant: 'outline', label: 'Paused' },
    DISABLED: { variant: 'outline', label: 'Disabled' },
};

/**
 * Status pill for a template.
 *  - INTERNAL templates have no Meta approval lifecycle → show a neutral "Internal" badge.
 *  - WHATSAPP templates show their approvalStatus; REJECTED reveals the reason on hover.
 */
export function TemplateStatusBadge({ template }: { template: Template }) {
    if (template.type === 'INTERNAL') {
        return <Badge variant="outline">Internal</Badge>;
    }

    const status = template.approvalStatus ?? 'DRAFT';
    const style = STATUS_STYLES[status];

    return (
        <Badge
            variant={style.variant}
            title={status === 'REJECTED' && template.rejectionReason ? template.rejectionReason : undefined}
        >
            {style.label}
        </Badge>
    );
}
