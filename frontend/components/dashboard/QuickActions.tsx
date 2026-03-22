'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { PermissionGate } from '@/components/PermissionGate';

/**
 * Quick action cards on the dashboard.
 * Each card is wrapped in PermissionGate — shows only if user has access.
 */
export function QuickActions() {
    return (
        <div className="card-grid-3">
            <PermissionGate action="read" subject="enquiry">
                <Link href="/enquiry" className="block group">
                    <Card className="h-full hover:border-primary/30 transition-all group-hover:shadow-md">
                        <CardContent className="p-5">
                            <svg className="h-5 w-5 text-muted-foreground mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" />
                            </svg>
                            <h3 className="font-semibold text-sm">View All Enquiries</h3>
                            <p className="text-xs text-muted-foreground mt-1">Browse, filter, and manage</p>
                        </CardContent>
                    </Card>
                </Link>
            </PermissionGate>

            <PermissionGate action="read" subject="user">
                <Link href="/users" className="block group">
                    <Card className="h-full hover:border-primary/30 transition-all group-hover:shadow-md">
                        <CardContent className="p-5">
                            <svg className="h-5 w-5 text-muted-foreground mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                            </svg>
                            <h3 className="font-semibold text-sm">Manage Team</h3>
                            <p className="text-xs text-muted-foreground mt-1">Users and roles</p>
                        </CardContent>
                    </Card>
                </Link>
            </PermissionGate>

            <PermissionGate action="read" subject="enquiry">
                <Link href="/enquiry?status=NEW" className="block group">
                    <Card className="h-full hover:border-primary/30 transition-all group-hover:shadow-md">
                        <CardContent className="p-5">
                            <svg className="h-5 w-5 text-amber-500 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
                            </svg>
                            <h3 className="font-semibold text-sm">New Enquiries</h3>
                            <p className="text-xs text-muted-foreground mt-1">Review unhandled items</p>
                        </CardContent>
                    </Card>
                </Link>
            </PermissionGate>
        </div>
    );
}
