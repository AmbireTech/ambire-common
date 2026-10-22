"use strict";
/**
 * Helpers for large string lists kept sorted (default JS string order, i.e. UTF-16 code units) and
 * free of duplicates, so membership is a binary search instead of a Set.
 *
 * A Set of a few hundred thousand strings costs extra memory on top of the array it is built from,
 * and building it is the slowest part of loading such a list on a slow device. A sorted array is
 * already in the shape it is stored in, so loading it needs no extra structure at all.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySortedDelta = exports.toSortedUnique = exports.isSortedUnique = exports.sortedIncludes = void 0;
/** Index of the first element that is not smaller than `value`. */
const lowerBound = (sortedList, value) => {
    let low = 0;
    let high = sortedList.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (sortedList[middle] < value)
            low = middle + 1;
        else
            high = middle;
    }
    return low;
};
/** Whether `sortedList` holds `value`. `sortedList` must be sorted and free of duplicates. */
const sortedIncludes = (sortedList, value) => {
    const index = lowerBound(sortedList, value);
    return index < sortedList.length && sortedList[index] === value;
};
exports.sortedIncludes = sortedIncludes;
/** Whether the list is strictly ascending, i.e. sorted and free of duplicates. */
const isSortedUnique = (list) => {
    for (let i = 1; i < list.length; i++) {
        if (!(list[i - 1] < list[i]))
            return false;
    }
    return true;
};
exports.isSortedUnique = isSortedUnique;
/** A sorted copy of `values` without duplicates. */
const toSortedUnique = (values) => {
    const sorted = [...values].sort();
    return sorted.filter((value, index) => index === 0 || value !== sorted[index - 1]);
};
exports.toSortedUnique = toSortedUnique;
// Upper bound on the arguments passed to one concat call, well below the engines' argument limits
const MAX_CHUNKS_PER_CONCAT = 10_000;
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
const applySortedDelta = (sortedList, ops) => {
    const lastOpByValue = new Map();
    ops.forEach(({ op, value }) => lastOpByValue.set(value, op));
    const changedValues = (0, exports.toSortedUnique)([...lastOpByValue.keys()]);
    const chunks = [];
    let copiedUntil = 0;
    changedValues.forEach((value) => {
        const index = lowerBound(sortedList, value);
        const isPresent = index < sortedList.length && sortedList[index] === value;
        const op = lastOpByValue.get(value);
        if (op === 'add' && !isPresent) {
            chunks.push(sortedList.slice(copiedUntil, index), [value]);
            copiedUntil = index;
        }
        if (op === 'remove' && isPresent) {
            chunks.push(sortedList.slice(copiedUntil, index));
            copiedUntil = index + 1;
        }
    });
    chunks.push(sortedList.slice(copiedUntil));
    let result = [];
    for (let i = 0; i < chunks.length; i += MAX_CHUNKS_PER_CONCAT) {
        result = result.concat(...chunks.slice(i, i + MAX_CHUNKS_PER_CONCAT));
    }
    return result;
};
exports.applySortedDelta = applySortedDelta;
//# sourceMappingURL=sortedList.js.map