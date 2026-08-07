import {
    ColumnDef,
    PaginationState,
    RowSelectionState,
    SortingState,
} from '@tanstack/react-table';
import { ReactNode } from 'react';

export interface PaginationConfig {
    pageIndex: number;
    pageSize: number;
}

export interface DataTableEmptyState {
    title?: string;
    description?: string;
    icon?: ReactNode;
}

export interface RowAction<TData> {
    label: string;
    icon?: ReactNode;
    onClick: (row: TData) => void;
    disabled?: boolean;
    variant?: 'default' | 'destructive';
}

export interface DataTableProps<TData, TValue = any> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    loading?: boolean;
    error?: Error | string | null;
    onRetry?: () => void;
    pagination?: PaginationConfig;
    pageCount?: number;
    total?: number;
    pageSizeOptions?: number[];
    sorting?: SortingState;
    onSortingChange?: (sorting: SortingState) => void;
    onPaginationChange?: (pagination: PaginationConfig) => void;
    selectable?: boolean;
    onRowSelectionChange?: (selectedRows: TData[]) => void;
    rowActions?: ((row: TData) => ReactNode) | ((row: TData) => RowAction<TData>[]) | RowAction<TData>[];
    emptyState?: DataTableEmptyState;
    className?: string;
    getRowId?: (row: TData, index: number) => string;
}

export interface UseDataTableProps<TData, TValue = any> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    loading?: boolean;
    pagination?: PaginationConfig;
    pageCount?: number;
    sorting?: SortingState;
    onSortingChange?: (sorting: SortingState) => void;
    onPaginationChange?: (pagination: PaginationConfig) => void;
    selectable?: boolean;
    onRowSelectionChange?: (selectedRows: TData[]) => void;
    getRowId?: (row: TData, index: number) => string;
}
