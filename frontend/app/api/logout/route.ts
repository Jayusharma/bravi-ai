import { clearAuthToken } from '@/lib/Auth';
import { NextResponse } from 'next/server';

export async function POST() {
    await clearAuthToken();
    return NextResponse.json({ success: true });
}
