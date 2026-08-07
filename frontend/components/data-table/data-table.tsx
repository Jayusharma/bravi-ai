'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    flexRender,
    HeaderGroup,
    Header,
    Row,
    Cell,
} from '@tanstack/react-table';
import {
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    ChevronLeft,
    ChevronRight,
    AlertTriangle,
    Inbox,
    MoreVertical,
    RefreshCw,
} from 'lucide-react';

import { DataTableProps } from './types';
import { useDataTable } from './use-data-table';

/* Generates page numbers: 1 2 3 ... 52  or  1 ... 4 5 6 ... 52 */
function getPageNumbers(current: number, total: number): (number | '...')[] {
    if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | '...')[] = [1];
    if (current > 3) pages.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
}

export function DataTable<TData, TValue = any>({
    columns,
    data,
    loading = false,
    error = null,
    onRetry,
    pagination,
    pageCount = -1,
    total,
    pageSizeOptions = [10, 25, 50, 100],
    sorting,
    onSortingChange,
    onPaginationChange,
    selectable = false,
    onRowSelectionChange,
    rowActions,
    emptyState,
    className = '',
    getRowId,
}: DataTableProps<TData, TValue>) {
    const { table } = useDataTable({
        columns,
        data,
        loading,
        pagination,
        pageCount,
        sorting,
        onSortingChange,
        onPaginationChange,
        selectable,
        onRowSelectionChange,
        getRowId,
    });

    const currentPageIndex = pagination?.pageIndex ?? 0;
    const currentPageSize = pagination?.pageSize ?? 10;
    const computedTotal = total ?? data.length;
    const computedPageCount =
        pageCount > 0 ? pageCount : Math.ceil(computedTotal / currentPageSize);

    const fromItem = computedTotal === 0 ? 0 : currentPageIndex * currentPageSize + 1;
    const toItem = Math.min((currentPageIndex + 1) * currentPageSize, computedTotal);

    const pageNumbers = useMemo(
        () => getPageNumbers(currentPageIndex + 1, Math.max(1, computedPageCount)),
        [currentPageIndex, computedPageCount]
    );

    return (
        <div className={`flex flex-col w-full ${className}`}>
            {/* Table */}
            <div className="w-full overflow-hidden rounded-xl border border-border bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        {/* Header */}
                        <thead>
                            {table.getHeaderGroups().map((headerGroup: HeaderGroup<TData>) => (
                                <tr key={headerGroup.id} className="border-b border-border bg-muted/40">
                                    {headerGroup.headers.map((header: Header<TData, unknown>) => {
                                        const canSort = header.column.getCanSort();
                                        const isSorted = header.column.getIsSorted();

                                        return (
                                            <th
                                                key={header.id}
                                                style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                                                className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none whitespace-nowrap"
                                            >
                                                {header.isPlaceholder ? null : canSort ? (
                                                    <button
                                                        type="button"
                                                        onClick={header.column.getToggleSortingHandler()}
                                                        className="flex items-center gap-1 transition hover:text-foreground outline-none group cursor-pointer"
                                                    >
                                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                                        <span className="text-muted-foreground/50 group-hover:text-foreground/70">
                                                            {isSorted === 'asc' ? (
                                                                <ArrowUp className="h-3 w-3 text-primary" />
                                                            ) : isSorted === 'desc' ? (
                                                                <ArrowDown className="h-3 w-3 text-primary" />
                                                            ) : (
                                                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                                                            )}
                                                        </span>
                                                    </button>
                                                ) : (
                                                    flexRender(header.column.columnDef.header, header.getContext())
                                                )}
                                            </th>
                                        );
                                    })}
                                    {rowActions ? (
                                        <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right w-14 select-none" />
                                    ) : null}
                                </tr>
                            ))}
                        </thead>

                        {/* Body */}
                        <tbody className="text-sm text-foreground">
                            {loading ? (
                                <SkeletonRows columnsCount={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} />
                            ) : error ? (
                                <tr>
                                    <td
                                        colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                                        className="py-12 px-6"
                                    >
                                        <ErrorState error={error} onRetry={onRetry} />
                                    </td>
                                </tr>
                            ) : table.getRowModel().rows.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                                        className="py-16 px-6"
                                    >
                                        <EmptyState emptyState={emptyState} />
                                    </td>
                                </tr>
                            ) : (
                                table.getRowModel().rows.map((row: Row<TData>) => (
                                    <tr
                                        key={row.id}
                                        className={`border-b border-border last:border-b-0 transition-colors duration-100 hover:bg-muted/30 ${
                                            row.getIsSelected() ? 'bg-primary/5' : ''
                                        }`}
                                    >
                                        {row.getVisibleCells().map((cell: Cell<TData, unknown>) => (
                                            <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        ))}

                                        {rowActions ? (
                                            <td className="px-4 py-3 whitespace-nowrap text-right">
                                                <RowActionsMenu row={row.original} rowActions={rowActions} />
                                            </td>
                                        ) : null}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Bar — inside the card, at the bottom */}
                {!error && !loading && computedTotal > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
                        {/* Left: Showing X to Y of Z */}
                        <span className="text-xs text-muted-foreground">
                            Showing{' '}
                            <span className="font-medium text-foreground">{fromItem}</span> to{' '}
                            <span className="font-medium text-foreground">{toItem}</span> of{' '}
                            <span className="font-medium text-foreground">{computedTotal.toLocaleString()}</span>
                        </span>

                        {/* Right: Rows per page + page numbers */}
                        <div className="flex items-center gap-5">
                            {/* Rows per page */}
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>Rows per page</span>
                                <select
                                    value={currentPageSize}
                                    onChange={(e) => {
                                        if (onPaginationChange) {
                                            onPaginationChange({ pageIndex: 0, pageSize: Number(e.target.value) });
                                        }
                                    }}
                                    className="h-7 rounded-md border border-border bg-card px-2 text-xs text-foreground outline-none cursor-pointer"
                                >
                                    {pageSizeOptions.map((opt) => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Page numbers */}
                            <div className="flex items-center gap-0.5">
                                {/* Prev */}
                                <button
                                    type="button"
                                    disabled={currentPageIndex === 0}
                                    onClick={() => onPaginationChange?.({ pageIndex: currentPageIndex - 1, pageSize: currentPageSize })}
                                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition outline-none cursor-pointer"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                </button>

                                {pageNumbers.map((p, idx) =>
                                    p === '...' ? (
                                        <span key={`dots-${idx}`} className="px-1.5 text-xs text-muted-foreground select-none">…</span>
                                    ) : (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => onPaginationChange?.({ pageIndex: (p as number) - 1, pageSize: currentPageSize })}
                                            className={`flex h-7 min-w-[28px] items-center justify-center rounded-md text-xs font-medium transition outline-none cursor-pointer ${
                                                p === currentPageIndex + 1
                                                    ? 'bg-primary text-primary-foreground'
                                                    : 'text-foreground hover:bg-muted'
                                            }`}
                                        >
                                            {p}
                                        </button>
                                    )
                                )}

                                {/* Next */}
                                <button
                                    type="button"
                                    disabled={currentPageIndex >= computedPageCount - 1}
                                    onClick={() => onPaginationChange?.({ pageIndex: currentPageIndex + 1, pageSize: currentPageSize })}
                                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition outline-none cursor-pointer"
                                >
                                    <ChevronRight className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── INTERNAL HELPERS ─── */

function SkeletonRows({ columnsCount }: { columnsCount: number }) {
    return (
        <>
            {Array.from({ length: 6 }).map((_, rIdx) => (
                <tr key={rIdx} className="border-b border-border">
                    {Array.from({ length: columnsCount }).map((_, cIdx) => (
                        <td key={cIdx} className="px-4 py-3.5">
                            <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

function EmptyState({ emptyState }: { emptyState?: DataTableProps<any>['emptyState'] }) {
    return (
        <div className="flex flex-col items-center justify-center text-center py-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                {emptyState?.icon || <Inbox className="h-5 w-5 stroke-[1.5]" />}
            </div>
            <h3 className="text-sm font-semibold text-foreground">{emptyState?.title || 'No data found'}</h3>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {emptyState?.description || 'There are no records matching your request.'}
            </p>
        </div>
    );
}

function ErrorState({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
    const message = typeof error === 'string' ? error : error.message || 'Failed to load data';
    return (
        <div className="flex flex-col items-center justify-center text-center py-4">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <AlertTriangle className="h-5 w-5 stroke-[1.5]" />
            </div>
            <h3 className="text-sm font-semibold text-destructive">Something went wrong</h3>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{message}</p>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition outline-none"
                >
                    <RefreshCw className="h-3 w-3" /> Retry
                </button>
            )}
        </div>
    );
}

function RowActionsMenu<TData>({ row, rowActions }: { row: TData; rowActions: DataTableProps<TData>['rowActions'] }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    let actionsList: any[] = [];
    if (typeof rowActions === 'function') {
        const result = rowActions(row);
        if (Array.isArray(result)) actionsList = result;
        else return <>{result}</>;
    } else if (Array.isArray(rowActions)) {
        actionsList = rowActions;
    }
    if (!actionsList.length) return null;

    return (
        <div className="relative inline-block text-left" ref={menuRef}>
            <button
                type="button"
                onClick={() => setOpen((p) => !p)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition outline-none cursor-pointer"
            >
                <MoreVertical className="h-4 w-4" />
            </button>

            {open && (
                <div className="absolute right-0 top-full z-50 mt-1 min-w-[150px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                    {actionsList.map((action, idx) => (
                        <button
                            key={idx}
                            type="button"
                            disabled={action.disabled}
                            onClick={() => { setOpen(false); action.onClick(row); }}
                            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition outline-none ${
                                action.variant === 'destructive'
                                    ? 'text-destructive hover:bg-destructive/10'
                                    : 'text-foreground hover:bg-muted'
                            } disabled:opacity-30 disabled:pointer-events-none`}
                        >
                            {action.icon && <span className="shrink-0">{action.icon}</span>}
                            {action.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
