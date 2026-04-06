import { ReactNode } from 'react';
import { DashboardLayout } from '@/components/dashboard';

export default function DashboardGroupLayout({ children }: { children: ReactNode }) {
    return <DashboardLayout>{children}</DashboardLayout>;
}
