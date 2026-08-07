import React, { useCallback, useMemo, useState } from 'react';
import {
    ColumnDef,
    getCoreRowModel,
    OnChangeFn,
    PaginationState,
    RowSelectionState,
    SortingState,
    useReactTable,
} from '@tanstack/react-table';
import { UseDataTableProps } from './types';

export function useDataTable<TData, TValue = any>({
    columns,
    data,
    loading = false,
    pagination,
    pageCount = -1,
    sorting,
    onSortingChange,
    onPaginationChange,
    selectable = false,
    onRowSelectionChange,
    getRowId,
}: UseDataTableProps<TData, TValue>) {
    const [internalSorting, setInternalSorting] = useState<SortingState>(sorting || []);
    const [internalPagination, setInternalPagination] = useState<PaginationState>({
        pageIndex: pagination?.pageIndex ?? 0,
        pageSize: pagination?.pageSize ?? 10,
    });
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

    const currentSorting = sorting ?? internalSorting;
    const currentPagination = pagination ?? internalPagination;

    const handleSortingChange: OnChangeFn<SortingState> = useCallback(
        (updaterOrValue) => {
            const nextSorting =
                typeof updaterOrValue === 'function'
                    ? updaterOrValue(currentSorting)
                    : updaterOrValue;

            if (onSortingChange) {
                onSortingChange(nextSorting);
            } else {
                setInternalSorting(nextSorting);
            }
        },
        [currentSorting, onSortingChange]
    );

    const handlePaginationChange: OnChangeFn<PaginationState> = useCallback(
        (updaterOrValue) => {
            const nextPagination =
                typeof updaterOrValue === 'function'
                    ? updaterOrValue(currentPagination)
                    : updaterOrValue;

            if (onPaginationChange) {
                onPaginationChange(nextPagination);
            } else {
                setInternalPagination(nextPagination);
            }
        },
        [currentPagination, onPaginationChange]
    );

    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = useCallback(
        (updaterOrValue) => {
            setRowSelection((prev) => {
                const next =
                    typeof updaterOrValue === 'function'
                        ? updaterOrValue(prev)
                        : updaterOrValue;

                if (onRowSelectionChange) {
                    const selectedRows = Object.keys(next)
                        .filter((key) => next[key])
                        .map((indexStr) => {
                            const idx = parseInt(indexStr, 10);
                            return data[idx];
                        })
                        .filter(Boolean);

                    onRowSelectionChange(selectedRows);
                }
                return next;
            });
        },
        [data, onRowSelectionChange]
    );

    // Prepends selection checkbox column if selectable = true
    const finalColumns = useMemo<ColumnDef<TData, TValue>[]>(() => {
        if (!selectable) return columns;

        const selectionColumn: ColumnDef<TData, TValue> = {
            id: 'select',
            header: ({ table }) =>
                React.createElement(
                    'div',
                    { className: 'flex items-center justify-center px-1' },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: table.getIsAllPageRowsSelected(),
                        ref: (el: HTMLInputElement | null) => {
                            if (el) {
                                el.indeterminate = table.getIsSomePageRowsSelected();
                            }
                        },
                        onChange: table.getToggleAllPageRowsSelectedHandler(),
                        className:
                            'h-4 w-4 rounded border-white/20 bg-[#161A29] text-indigo-500 transition focus:ring-0 focus:ring-offset-0 cursor-pointer accent-indigo-500',
                        'aria-label': 'Select all rows',
                    })
                ),
            cell: ({ row }) =>
                React.createElement(
                    'div',
                    { className: 'flex items-center justify-center px-1' },
                    React.createElement('input', {
                        type: 'checkbox',
                        checked: row.getIsSelected(),
                        onChange: row.getToggleSelectedHandler(),
                        className:
                            'h-4 w-4 rounded border-white/20 bg-[#161A29] text-indigo-500 transition focus:ring-0 focus:ring-offset-0 cursor-pointer accent-indigo-500',
                        'aria-label': `Select row ${row.id}`,
                    })
                ),
            enableSorting: false,
            enableHiding: false,
            size: 44,
        };

        return [selectionColumn, ...columns];
    }, [columns, selectable]);

    const table = useReactTable({
        data,
        columns: finalColumns,
        state: {
            sorting: currentSorting,
            pagination: currentPagination,
            rowSelection,
        },
        pageCount: pageCount,
        manualSorting: true,
        manualPagination: true,
        onSortingChange: handleSortingChange,
        onPaginationChange: handlePaginationChange,
        onRowSelectionChange: handleRowSelectionChange,
        getCoreRowModel: getCoreRowModel(),
        getRowId: getRowId,
    });

    return {
        table,
        currentSorting,
        currentPagination,
        rowSelection,
    };
}
