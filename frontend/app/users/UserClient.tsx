'use client';

import { useState } from 'react';
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/Table";
import { Card, CardContent } from "@/components/ui/Card";
import { useRouter } from 'next/navigation';
import { createUserAction } from './actions';

interface User {
    id: string;
    userName: string;
    email?: string;
    displayName?: string;
    role: string;
    isActive: boolean;
    createdAt: string;
    _count?: { assignedEnquiries: number };
}

export default function UserClient({ initialUsers }: { initialUsers: User[] }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        const formData = new FormData(e.currentTarget);

        try {
            const result = await createUserAction(null, formData);
            if (result?.error) {
                setError(result.error);
            } else {
                setIsModalOpen(false);
                router.refresh();
            }
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    const getRoleBadgeColor = (role: string) => {
        switch (role) {
            case 'ADMIN': return 'bg-red-500/10 text-red-500 border-red-500/20';
            case 'MANAGER': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
            case 'SALES': return 'bg-green-500/10 text-green-500 border-green-500/20';
            case 'OPS': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
            default: return 'bg-secondary text-secondary-foreground';
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Users</h1>
                    <p className="text-muted-foreground mt-1">Manage team members and their roles</p>
                </div>
                <Button onClick={() => setIsModalOpen(true)}>+ Add User</Button>
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>User</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Enquiries</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Joined</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {initialUsers.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <div className="font-medium">{user.displayName || user.userName}</div>
                                        <div className="text-sm text-muted-foreground">{user.email || user.userName}</div>
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getRoleBadgeColor(user.role)}`}>
                                            {user.role}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {user._count?.assignedEnquiries ?? 0}
                                    </TableCell>
                                    <TableCell>
                                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${user.isActive ? 'text-green-500' : 'text-muted-foreground'}`}>
                                            <span className={`w-1.5 h-1.5 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-muted-foreground'}`}></span>
                                            {user.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {new Date(user.createdAt).toLocaleDateString('en-GB', {
                                            day: '2-digit',
                                            month: '2-digit',
                                            year: 'numeric'
                                        })}
                                    </TableCell>
                                </TableRow>
                            ))}
                            {initialUsers.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                        No users found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add New User">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Username *</label>
                        <Input
                            name="userName"
                            required
                            minLength={3}
                            placeholder="johndoe"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Display Name</label>
                        <Input
                            name="displayName"
                            placeholder="John Doe"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Email</label>
                        <Input
                            name="email"
                            type="email"
                            placeholder="john@example.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Password *</label>
                        <Input
                            type="password"
                            name="password"
                            required
                            minLength={8}
                            placeholder="Min 8 characters"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Role *</label>
                        <select
                            name="role"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            <option value="SALES">Sales</option>
                            <option value="MANAGER">Manager</option>
                            <option value="OPS">Operations</option>
                            <option value="ADMIN">Admin</option>
                        </select>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <div className="flex justify-end space-x-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Creating...' : 'Create User'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
