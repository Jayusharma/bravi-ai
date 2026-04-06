    'use client';

    import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
    import { useRouter } from 'next/navigation';
    import { APP_ROLES, CRUD_ACTIONS, type AppRole } from '@/lib/roles';
    import { useToast } from '@/components/ui/Toast';
    import { handleResult, handleVoidResult } from '@/lib/error';
    import {
        createSubjectBundle,
        deletePermission,
        saveRolePermissions,
        updatePermission,
        type PermissionRecord,
        type RolePermissionRecord,
    } from '@/services/dashboard';

    // ═══════════════════════════════════════════════════════════════════
    // DISPLAY COLUMNS — Maps CRUD actions to user-friendly labels
    // ═══════════════════════════════════════════════════════════════════

    const DISPLAY_COLUMNS = [
        { label: 'ADD', action: 'create' },
        { label: 'EDIT', action: 'update' },
        { label: 'DELETE', action: 'delete' },
        { label: 'VIEW', action: 'read' },
    ] as const;

    // ═══════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════

    interface PermissionProps {
        permissions: PermissionRecord[];
        assignments: RolePermissionRecord[];
    }

    interface SubjectRow {
        subject: string;
        actionMap: Partial<Record<string, PermissionRecord>>;
    }

    function buildRoleSelection(assignments: RolePermissionRecord[], role: AppRole) {
        return new Set(
            assignments
                .filter((a) => a.role === role)
                .map((a) => a.permissionId),
        );
    }

    function formatSubjectLabel(subject: string): string {
        // Convert camelCase/PascalCase to spaced words, then capitalize first letter
        return subject
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_-]/g, ' ')
            .replace(/^./, (s) => s.toUpperCase())
            .trim();
    }

    // ═══════════════════════════════════════════════════════════════════
    // COMPONENT
    // ═══════════════════════════════════════════════════════════════════

    export function Permission({ permissions, assignments }: PermissionProps) {
        const router = useRouter();
        const toast = useToast();
        const subjectInputRef = useRef<HTMLInputElement>(null);
        const menuRef = useRef<HTMLDivElement | null>(null);
        const [selectedRole, setSelectedRole] = useState<AppRole>('ADMIN');
        const [selectedIds, setSelectedIds] = useState<Set<string>>(() => buildRoleSelection(assignments, 'ADMIN'));
        const [subjectInput, setSubjectInput] = useState('');
        const [isModalOpen, setIsModalOpen] = useState(false);
        const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
        const [editingSubject, setEditingSubject] = useState<string | null>(null);
        const [openMenuSubject, setOpenMenuSubject] = useState<string | null>(null);
        const [isPending, startTransition] = useTransition();

        // Build subject rows dynamically from actual database permissions
        const subjectRows: SubjectRow[] = useMemo(() => {
            const subjectMap = new Map<string, Partial<Record<string, PermissionRecord>>>();

            for (const permission of permissions) {
                // Only include CRUD actions in the matrix
                if (!CRUD_ACTIONS.includes(permission.action as (typeof CRUD_ACTIONS)[number])) {
                    continue;
                }
                const actionMap = subjectMap.get(permission.subject) ?? {};
                actionMap[permission.action] = permission;
                subjectMap.set(permission.subject, actionMap);
            }

            return Array.from(subjectMap.entries())
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([subject, actionMap]) => ({ subject, actionMap }));
        }, [permissions]);

        useEffect(() => {
            if (isModalOpen) subjectInputRef.current?.focus();
        }, [isModalOpen]);

        useEffect(() => {
            if (!openMenuSubject) return;
            const handler = (e: MouseEvent) => {
                if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                    setOpenMenuSubject(null);
                }
            };
            document.addEventListener('mousedown', handler);
            return () => document.removeEventListener('mousedown', handler);
        }, [openMenuSubject]);

        // ── Handlers ──

        const handleRoleChange = (role: AppRole) => {
            setSelectedRole(role);
            setSelectedIds(buildRoleSelection(assignments, role));
        };

        const togglePermission = (permissionId: string) => {
            setSelectedIds((current) => {
                const next = new Set(current);
                next.has(permissionId) ? next.delete(permissionId) : next.add(permissionId);
                return next;
            });
        };

        const toggleColumnAll = (action: string, checked: boolean) => {
            setSelectedIds((current) => {
                const next = new Set(current);
                for (const row of subjectRows) {
                    const permission = row.actionMap[action];
                    if (permission) {
                        checked ? next.add(permission.id) : next.delete(permission.id);
                    }
                }
                return next;
            });
        };

        const isColumnAllChecked = (action: string): boolean => {
            let total = 0, checked = 0;
            for (const row of subjectRows) {
                const p = row.actionMap[action];
                if (p) {
                    total++;
                    if (selectedIds.has(p.id)) checked++;
                }
            }
            return total > 0 && checked === total;
        };

        const closeModal = () => {
            setIsModalOpen(false);
            setSubjectInput('');
            setModalMode('create');
            setEditingSubject(null);
        };

        const handleSubmitSubject = () => {
            const subject = subjectInput.trim().toLowerCase();
            if (!subject) {
                toast.warning('Missing Input', 'Subject name is required.');
                return;
            }

            startTransition(async () => {
                if (modalMode === 'edit') {
                    const row = subjectRows.find((r) => r.subject === editingSubject);
                    if (!row) {
                        toast.error('Not Found', 'Subject not found.');
                        return;
                    }
                    const perms = Object.values(row.actionMap).filter(Boolean) as PermissionRecord[];
                    const results = await Promise.all(
                        perms.map((p) => updatePermission(p.id, { subject })),
                    );
                    const failed = results.find((r) => !r.success);
                    if (failed) {
                        handleResult(failed, toast, { errorTitle: 'Update Failed' });
                        return;
                    }
                    toast.success('Subject Updated', `Permissions updated for "${subject}".`);
                } else {
                    const result = await createSubjectBundle(subject);
                    if (!handleResult(result, toast, {
                        successMessage: `Permissions created for "${subject}".`,
                        errorTitle: 'Create Failed',
                    })) return;
                }
                closeModal();
                setOpenMenuSubject(null);
                router.refresh();
            });
        };

        const handleSave = () => {
            startTransition(async () => {
                const result = await saveRolePermissions(
                    selectedRole,
                    [...selectedIds].map((id) => ({ permissionId: id })),
                );
                if (!handleVoidResult(result, toast, {
                    successMessage: `Permissions saved for ${selectedRole}.`,
                    errorTitle: 'Save Failed',
                })) return;
                router.refresh();
            });
        };

        const handleReset = () => {
            setSelectedIds(buildRoleSelection(assignments, selectedRole));
            toast.info('Reset', 'Changes discarded.');
        };

        const handleDeleteSubject = (subject: string) => {
            const row = subjectRows.find((r) => r.subject === subject);
            if (!row) {
                toast.error('Not Found', 'Subject not found.');
                return;
            }
            const perms = Object.values(row.actionMap).filter(Boolean) as PermissionRecord[];
            if (perms.length === 0) {
                toast.warning('Nothing to Delete', 'No permissions for this subject.');
                return;
            }
            if (!window.confirm(`Delete all permissions for "${subject}"?`)) return;

            startTransition(async () => {
                const results = await Promise.all(perms.map((p) => deletePermission(p.id)));
                const failed = results.find((r) => !r.success);
                if (failed) {
                    handleResult(failed, toast, { errorTitle: 'Delete Failed' });
                    return;
                }
                setSelectedIds((current) => {
                    const next = new Set(current);
                    perms.forEach((p) => next.delete(p.id));
                    return next;
                });
                setOpenMenuSubject(null);
                toast.success('Deleted', `Permissions deleted for "${subject}".`);
                router.refresh();
            });
        };

        const handleEditSubject = (subject: string) => {
            setModalMode('edit');
            setEditingSubject(subject);
            setSubjectInput(subject);
            setIsModalOpen(true);
            setOpenMenuSubject(null);
        };

        const handleOpenCreateModal = () => {
            setModalMode('create');
            setEditingSubject(null);
            setSubjectInput('');
            setIsModalOpen(true);
        };

        // ── Render ──

        return (
            <>
                <div className="page-container">
                    <section className="pm-card">
                        {/* ── Controls Bar: Role selector + Submit/Reset ── */}
                        <div className="pm-controls-bar">
                            <div className="pm-control-group">
                                <div className="pm-field">
                                    <label className="pm-field-label" htmlFor="pm-role">
                                        Role <span className="pm-required">*</span>
                                    </label>
                                    <select
                                        id="pm-role"
                                        value={selectedRole}
                                        onChange={(e) => handleRoleChange(e.target.value as AppRole)}
                                        className="pm-select"
                                    >
                                        {APP_ROLES.map((role) => (
                                            <option key={role} value={role}>
                                                {role.charAt(0) + role.slice(1).toLowerCase()}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="pm-meta">
                                    <span>{subjectRows.length} subjects</span>
                                    <span className="pm-meta-dot" />
                                    <span>{selectedIds.size} assigned</span>
                                </div>
                            </div>

                            <div className="pm-action-group">
                                <button type="button" onClick={handleSave} disabled={isPending} className="pm-btn-submit">
                                    {isPending ? 'Saving...' : 'Submit'}
                                </button>
                                <button type="button" onClick={handleReset} className="pm-btn-reset">
                                    Reset
                                </button>
                            </div>
                        </div>

                        {/* ── Permission Matrix Table ── */}
                        <div className="pm-table-wrap">
                            <table className="pm-table">
                                <thead>
                                    <tr className="pm-thead-row">
                                        <th className="pm-th pm-th-subject">SUB MENU</th>
                                        {DISPLAY_COLUMNS.map((col) => (
                                            <th key={col.label} className="pm-th pm-th-action">
                                                <div className="pm-th-action-inner">
                                                    {col.label}
                                                    <input
                                                        type="checkbox"
                                                        checked={isColumnAllChecked(col.action)}
                                                        onChange={(e) => toggleColumnAll(col.action, e.target.checked)}
                                                        className="pm-checkbox-header"
                                                        aria-label={`Select all ${col.label}`}
                                                    />
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {subjectRows.length > 0 ? (
                                        subjectRows.map((row) => (
                                            <tr key={row.subject} className="pm-data-row">
                                                <td className="pm-td-subject">
                                                    <div className="pm-subject-cell">
                                                        <span className="pm-subject-name">
                                                            {formatSubjectLabel(row.subject)}
                                                        </span>
                                                        <div className="pm-subject-actions" ref={openMenuSubject === row.subject ? menuRef : null}>
                                                            <button
                                                                type="button"
                                                                onClick={() => setOpenMenuSubject((c) => c === row.subject ? null : row.subject)}
                                                                className="pm-dots-btn"
                                                                aria-label={`Options for ${row.subject}`}
                                                            >
                                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                                                    <circle cx="5" cy="12" r="2" />
                                                                    <circle cx="12" cy="12" r="2" />
                                                                    <circle cx="19" cy="12" r="2" />
                                                                </svg>
                                                            </button>
                                                            {openMenuSubject === row.subject ? (
                                                                <div className="pm-dropdown">
                                                                    <button type="button" onClick={() => handleEditSubject(row.subject)} className="pm-dropdown-item">Edit</button>
                                                                    <button type="button" onClick={() => handleDeleteSubject(row.subject)} className="pm-dropdown-item pm-dropdown-danger">Delete</button>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </td>
                                                {DISPLAY_COLUMNS.map((col) => {
                                                    const perm = row.actionMap[col.action];
                                                    return (
                                                        <td key={col.label} className="pm-td-action">
                                                            {perm ? (
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedIds.has(perm.id)}
                                                                    onChange={() => togglePermission(perm.id)}
                                                                    className="pm-checkbox"
                                                                    aria-label={`${selectedRole} ${col.label} ${row.subject}`}
                                                                />
                                                            ) : (
                                                                <span className="pm-no-perm">—</span>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={DISPLAY_COLUMNS.length + 1} className="pm-empty">
                                                No permission scopes found. Add a new subject to begin.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* ── Footer ── */}
                        <div className="pm-footer">
                            <button type="button" onClick={handleOpenCreateModal} className="pm-btn-new-subject">
                                + New Subject
                            </button>
                            <button type="button" onClick={handleSave} disabled={isPending} className="pm-btn-save">
                                {isPending ? 'Saving...' : 'Save Rights'}
                            </button>
                        </div>
                    </section>
                </div>

                {/* ── Modal ── */}
                {isModalOpen ? (
                    <div className="pm-modal-overlay" onClick={closeModal}>
                        <div className="pm-modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="pm-modal-header">
                                <h3 className="pm-modal-title">
                                    {modalMode === 'edit' ? 'Edit Subject' : 'New Permission Scope'}
                                </h3>
                                <button type="button" onClick={closeModal} className="pm-modal-close" aria-label="Close">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div className="pm-modal-body">
                                <p className="pm-modal-desc">
                                    {modalMode === 'edit'
                                        ? 'Update the subject identifier. All permissions will be renamed.'
                                        : 'Define a new subject. A complete CRUD permission set will be created.'}
                                </p>
                                <div>
                                    <label className="pm-input-label" htmlFor="subject-name">Subject Name</label>
                                    <input
                                        id="subject-name"
                                        ref={subjectInputRef}
                                        value={subjectInput}
                                        onChange={(e) => setSubjectInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                handleSubmitSubject();
                                            }
                                        }}
                                        placeholder="e.g. telemetry, billing"
                                        className="pm-input"
                                    />
                                </div>
                            </div>
                            <div className="pm-modal-footer">
                                <button type="button" onClick={closeModal} className="pm-btn-cancel">Cancel</button>
                                <button type="button" onClick={handleSubmitSubject} disabled={isPending} className="pm-btn-submit">
                                    {modalMode === 'edit' ? 'Save Changes' : 'Create'}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </>
        );
    }
