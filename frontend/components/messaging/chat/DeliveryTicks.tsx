'use client';

import React from 'react';

/** Renders the delivery status icon for an outbound message bubble */
interface DeliveryTicksProps {
  status: string | null | undefined;
  className?: string;
}

export function DeliveryTicks({ status, className }: DeliveryTicksProps) {
  if (!status) return null;

  let icon: React.ReactNode;
  let color: string | undefined;

  switch (status) {
    case 'READ':
      icon = (
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}
        >
          <path d="M1 8.5l3.5 3.5 7-7" />
          <path d="M6 8.5l3.5 3.5 7-7" />
        </svg>
      );
      color = '#53bdeb'; // WhatsApp Read blue color
      break;
    case 'DELIVERED':
      icon = (
        <svg
          width="16"
          height="16"
          viewBox="0 0 20 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}
        >
          <path d="M1 8.5l3.5 3.5 7-7" />
          <path d="M6 8.5l3.5 3.5 7-7" />
        </svg>
      );
      break;
    case 'SENT':
      icon = (
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}
        >
          <path d="M3 8.5l3.5 3.5 7-7" />
        </svg>
      );
      break;
    case 'FAILED':
      icon = (
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}
        >
          <circle cx="8" cy="8" r="7" />
          <line x1="8" y1="5" x2="8" y2="9" />
          <line x1="8" y1="12" x2="8.01" y2="12" strokeWidth="2.5" />
        </svg>
      );
      color = '#ef4444'; // Red for failures
      break;
    default: // PENDING
      icon = (
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ display: 'inline-block', verticalAlign: 'middle', marginTop: '-2px' }}
        >
          <circle cx="8" cy="8" r="7" />
          <path d="M8 3.5V8h3.5" />
        </svg>
      );
  }

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '4px', ...(color ? { color } : {}) }}>
      {icon}
    </span>
  );
}
