'use client';

/** Renders the delivery status icon for an outbound message bubble */
interface DeliveryTicksProps {
  status: string | null | undefined;
  className?: string;
}

export function DeliveryTicks({ status, className }: DeliveryTicksProps) {
  if (!status) return null;

  let icon: string;
  let color: string | undefined;

  switch (status) {
    case 'READ':
      icon = '✓✓';
      color = '#34b7f1';
      break;
    case 'DELIVERED':
      icon = '✓✓';
      break;
    case 'SENT':
      icon = '✓';
      break;
    case 'FAILED':
      icon = '✗';
      color = '#ef4444';
      break;
    default: // PENDING
      icon = '🕐';
  }

  return (
    <span className={className} style={color ? { color } : undefined}>
      {icon}
    </span>
  );
}
