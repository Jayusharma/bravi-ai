import type { Metadata } from 'next';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign In — Enquiry Hub',
  description: 'Sign in to your Enquiry Hub account to manage enquiries, contacts, and team workflows.',
};

export default function LoginPage() {
  return <LoginForm />;
}
