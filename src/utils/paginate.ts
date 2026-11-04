/**
 * Split a list into pages of at most `limit` items each.
 * Use it to keep batched requests below the limits of an external API.
 */
export function paginate<T>(input: T[], limit: number): T[][] {
  const pages = []
  let from = 0
  for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
    pages.push(input.slice(from, i * limit))
    from += limit
  }
  return pages
}

/** Which page of a list to show, and how long a page is. */
export interface Pagination {
  /** Zero based. */
  fromPage: number
  itemsPerPage: number
}

/** One page of a list, with what the UI needs to move between pages. */
export interface PaginationResult<T> {
  items: T[]
  itemsTotal: number
  /** Zero based. */
  currentPage: number
  maxPages: number
}

/**
 * The page of `items` that `fromPage` points at. `itemsTotal` is overridable: a caller holding one
 * page cannot derive it, and navigation gates on it.
 */
export const getPage = <T>(
  items: T[],
  fromPage: number,
  itemsPerPage: number,
  itemsTotal = items.length
): PaginationResult<T> => ({
  items: items.slice(fromPage * itemsPerPage, fromPage * itemsPerPage + itemsPerPage),
  itemsTotal,
  currentPage: fromPage,
  maxPages: Math.ceil(itemsTotal / itemsPerPage)
})
