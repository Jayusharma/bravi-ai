import { serverFetch } from '@/lib/ServerApi';

export default async function UsersPage() {
  const users = await serverFetch('/user');

  return (
    <div>
      <h1>Users</h1>
      <pre>{JSON.stringify(users, null, 2)}</pre>
    </div>
  );
}
