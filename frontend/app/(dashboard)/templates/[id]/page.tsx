import { notFound } from 'next/navigation';
import { getTemplate } from '@/services/template';
import { TemplateForm } from '@/components/templates/TemplateForm';

export default async function EditTemplatePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const result = await getTemplate(id);

    if (!result.success || !result.data) {
        // 404 covers both "not found" and a backend that isn't live yet.
        notFound();
    }

    return <TemplateForm template={result.data} />;
}
