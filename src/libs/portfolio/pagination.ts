import {
  CollectionResult,
  ERC721Enumerable,
  ERC721Innumerable,
  MetaData,
  TokenResult
} from './interfaces'

export function paginate(
  input: string[] | [string, ERC721Enumerable | ERC721Innumerable][],
  limit: number
): any[][] {
  const pages = []
  let from = 0
  for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
    pages.push(input.slice(from, i * limit))
    from += limit
  }
  return pages
}

export function flattenResults(
  everything: Promise<[[string, TokenResult | CollectionResult][], MetaData][]>[]
): Promise<[[string, TokenResult | CollectionResult][], MetaData | {}]> {
  return Promise.all(everything).then((results) => {
    if (!results || !results.length) {
      return [[], {}]
    }

    const allTokens: any[] = []
    let metadata: MetaData = {}

    results.forEach((result) => {
      if (Array.isArray(result) && result.length > 0) {
        const [tokensArray, meta] = result
        if (Array.isArray(tokensArray)) {
          allTokens.push(...tokensArray)
        }
        metadata = { ...(meta as MetaData) }
      }
    })

    return [allTokens, metadata]
  })
}
