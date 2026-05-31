import { Permission } from '@/components/permissions';
import { getPermissions, getRoleAssignments } from '@/services/permissions';

export default async function PermissionsPage() {
    const [permissionsResult, assignmentsResult] = await Promise.all([
        getPermissions(),
        getRoleAssignments(),
    ]);

    const permissions = permissionsResult.data ?? [];
    const assignments = assignmentsResult.data ?? [];

    const permissionKey = JSON.stringify({
        permissions: permissions.map((permission) => ({
            id: permission.id,
            action: permission.action,
            subject: permission.subject,
        })),
        assignments: assignments.map((assignment) => ({
            id: assignment.id,
            role: assignment.role,
            permissionId: assignment.permissionId,
        })),
    });

    return <Permission key={permissionKey} permissions={permissions} assignments={assignments} />;
}
