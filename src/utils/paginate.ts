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
