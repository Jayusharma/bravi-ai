import { serverFetch } from '@/lib/ServerApi';
import UserClient from './UserClient';
import { DashboardLayout } from '@/components/DashboardLayout';

export default async function UsersPage() {
  let users = [];
  try {
    users = await serverFetch('/users');
  } catch (e) {
    console.error("Failed to fetch users", e);
  }

  return (
    <DashboardLayout>
      <UserClient initialUsers={users} />
    </DashboardLayout>
  );
}
