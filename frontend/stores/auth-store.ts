import { create } from 'zustand';
import { PureAbility, AbilityBuilder } from '@casl/ability';

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║                    AUTH STORE (Zustand + CASL)                     ║
 * ║                                                                   ║
 * ║  Stores user session and rebuilds CASL ability from DB rules.     ║
 * ║  Same @casl/ability library as backend → consistent permission    ║
 * ║  logic on both sides.                                             ║
 * ║                                                                   ║
 * ║  Usage:                                                           ║
 * ║    const { can } = useAuthStore();                                ║
 * ║    if (can('read', 'enquiry')) { ... }                            ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

// ── Types (matches backend casl.types.ts) ──

export type Actions =
    | 'create'
    | 'read'
    | 'update'
    | 'delete'
    | 'assign'
    | 'merge'
    | 'manage';

export type AppSubjects =
    | 'enquiry'
    | 'message'
    | 'user'
    | 'permission'
    | 'contact'
    | 'dashboard'
    | 'inboundmessage'
    | 'qualificationrule'
    | 'internalnote'
    | 'qualificationresult'
    | 'rolepermission'
    | 'chat'
    | 'all';

export type PermissionRule = {
    action: string;
    subject: string;
    conditions?: Record<string, unknown> | null;
};

export type User = {
    id: string;
    userName: string;
    email: string | null;
    displayName: string | null;
    role: string;
};

type AppAbility = PureAbility<[Actions, AppSubjects]>;
type AbilityClass = new (rules?: unknown[], options?: unknown) => AppAbility;

// Everything is lowercase — no mapping needed (matches backend)

// ═══════════════════════════════════════════════════════════════════
// BUILD CASL ABILITY FROM DB PERMISSION RULES
// ═══════════════════════════════════════════════════════════════════

function buildAbility(rules: PermissionRule[]): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(PureAbility as AbilityClass);

    for (const rule of rules) {
        const action = rule.action.toLowerCase() as Actions;
        const subject = rule.subject.toLowerCase() as AppSubjects;

        if (rule.conditions) {
            can(action, subject, rule.conditions);
        } else {
            can(action, subject);
        }
    }

    return build();
}

// ═══════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════

interface AuthState {
    user: User | null;
    permissions: PermissionRule[];
    ability: AppAbility;
    isLoaded: boolean;

    // Actions
    setSession: (user: User, permissions: PermissionRule[]) => void;
    clearSession: () => void;

    // Permission check — use this everywhere in client components
    // Accepts plain strings so you don't need to import types
    can: (action: string, subject: string) => boolean;
}

// Empty ability (no permissions) as default
const emptyAbility = buildAbility([]);

export const useAuthStore = create<AuthState>((set, get) => ({
    user: null,
    permissions: [],
    ability: emptyAbility,
    isLoaded: false,

    setSession: (user, permissions) => {
        const ability = buildAbility(permissions);
        set({ user, permissions, ability, isLoaded: true });
    },

    clearSession: () => {
        set({ user: null, permissions: [], ability: emptyAbility, isLoaded: false });
    },

    can: (action, subject) => {
        return get().ability.can(action as Actions, subject as AppSubjects);
    },
}));
