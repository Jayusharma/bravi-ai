import { listChannels } from '@/services/channel';
import { ChannelsClient } from '@/components/channels/ChannelsClient';

export default async function ChannelsPage() {
    const result = await listChannels();
    const initialData = result.data ?? [];

    return (
        <div className="space-y-4">
            {!result.success ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                    Couldn&apos;t load channels: {result.error}
                </div>
            ) : null}
            <ChannelsClient initialData={initialData} />
        </div>
    );
}
