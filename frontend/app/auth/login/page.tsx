import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/auth';
import { getCurrentUser } from '@/services/auth';

export const metadata: Metadata = {
    title: 'Sign In - Enquiry Hub',
    description: 'Sign in to your Enquiry Hub account to manage enquiries, contacts, and team workflows.',
};

export default async function LoginPage() {
    const user = await getCurrentUser();
    if (user) {
        redirect('/dashboard');
    }

    return <LoginForm />;
}
