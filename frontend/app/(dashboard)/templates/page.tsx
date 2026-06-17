import { listTemplates } from '@/services/template';
import { TemplateList } from '@/components/templates/TemplateList';

export default async function TemplatesPage() {
    const result = await listTemplates({ page: 1, limit: 50 });
    const initialData = result.data?.data ?? [];
    const initialMeta = result.data?.meta ?? { total: 0, page: 1, limit: 50, totalPages: 1 };

    return (
        <div className="space-y-4">
            {!result.success ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                    Couldn&apos;t load templates: {result.error}
                </div>
            ) : null}
            <TemplateList initialData={initialData} initialMeta={initialMeta} />
        </div>
    );
}
