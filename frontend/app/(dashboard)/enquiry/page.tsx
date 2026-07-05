import { getEnquiries, getEnquiryStats } from '@/services/enquiry/enquiry.service';
import EnquiriesClient from '@/components/enquiry/EnquiriesClient';

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;
  const status = params?.status || '';
  const source = params?.source || '';
  const search = params?.search || '';
  const page = parseInt(params?.page || '1', 10);
  const limit = parseInt(params?.limit || '10', 10);

  // Fetch initial data server-side (parallel)
  const [initialData, initialStats] = await Promise.all([
    getEnquiries({
      status: status || undefined,
      source: source || undefined,
      search: search || undefined,
      page,
      limit,
    }).catch(() => ({ items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } })),
    getEnquiryStats().catch(() => ({
      byStatus: {},
      unassigned: 0,
      totalOpen: 0,
      kpis: { all: 0, new: 0, inProgress: 0, followUp: 0, converted: 0, closedLost: 0, newThisWeek: 0 },
      overview: { total: 0, byStatus: {}, changeVsLastMonth: 0 },
      sourceBreakdown: [],
    })),
  ]);

  return (
    <EnquiriesClient
      initialData={initialData}
      initialStats={initialStats}
    />
  );
}
