export const APP_ROLES = ['ADMIN', 'MANAGER', 'SALES', 'OPS'] as const;

export type AppRole = typeof APP_ROLES[number];

export const CRUD_ACTIONS = ['create', 'read', 'update', 'delete'] as const;

export type CrudAction = typeof CRUD_ACTIONS[number];
