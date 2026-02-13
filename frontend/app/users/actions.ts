'use server'

import { serverFetch } from "@/lib/ServerApi";
import { revalidatePath } from "next/cache";

export async function createUserAction(prevState: any, formData: FormData) {
    const userName = formData.get('userName') as string;
    const email = formData.get('email') as string;
    const displayName = formData.get('displayName') as string;
    const password = formData.get('password') as string;
    const role = formData.get('role') as string;

    if (!userName || !password || !role) {
        return { error: 'Missing required fields' };
    }

    try {
        await serverFetch('/users', {
            method: 'POST',
            body: JSON.stringify({
                userName,
                email: email || undefined,
                displayName: displayName || undefined,
                password,
                role,
            }),
        });
        revalidatePath('/users');
        return { success: true };
    } catch (error: any) {
        return { error: error.message || 'Failed to create user' };
    }
}
