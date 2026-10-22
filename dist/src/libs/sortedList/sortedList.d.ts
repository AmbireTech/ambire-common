/**
 * Helpers for large string lists kept sorted (default JS string order, i.e. UTF-16 code units) and
 * free of duplicates, so membership is a binary search instead of a Set.
 *
 * A Set of a few hundred thousand strings costs extra memory on top of the array it is built from,
 * and building it is the slowest part of loading such a list on a slow device. A sorted array is
 * already in the shape it is stored in, so loading it needs no extra structure at all.
 */
/** Whether `sortedList` holds `value`. `sortedList` must be sorted and free of duplicates. */
export declare const sortedIncludes: (sortedList: readonly string[], value: string) => boolean;
/** Whether the list is strictly ascending, i.e. sorted and free of duplicates. */
export declare const isSortedUnique: (list: readonly string[]) => boolean;
/** A sorted copy of `values` without duplicates. */
export declare const toSortedUnique: (values: readonly string[]) => string[];
export type SortedListDeltaOp = {
    op: 'add' | 'remove';
    value: string;
};
/**
 * Applies add/remove operations in the order given and returns a new sorted, duplicate-free list.
 * Equivalent to replaying them on a Set: only the last operation for a value decides whether it
 * ends up in the list.
 *
 * Each change is located with a binary search, and the untouched runs between changes are copied
 * with `slice` and joined with `concat`. Both are native bulk copies, which matters on Hermes: a
 * per-element loop over a few hundred thousand entries takes over 100ms there, and `splice` for
 * every change is far slower still.
 */
export declare const applySortedDelta: (sortedList: readonly string[], ops: readonly SortedListDeltaOp[]) => string[];
//# sourceMappingURL=sortedList.d.ts.map