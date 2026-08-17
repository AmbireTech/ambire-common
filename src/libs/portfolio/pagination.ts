import { MetaData, TokenError } from './interfaces'

export function flattenResults<T>(
  everything: Promise<[[string, T][], MetaData][]>[]
): Promise<[[TokenError, T][], MetaData | {}]> {
  return Promise.all(everything).then((results) => {
    if (!results || !results.length) {
      return [[], {}]
    }

    const allTokens: any[] = []
    let metadata: MetaData = {}

    results.forEach((result) => {
      if (Array.isArray(result) && result.length > 0) {
        const [hintsArray, meta] = result

        if (Array.isArray(hintsArray)) {
          allTokens.push(...hintsArray)
        }
        if (Object.keys(metadata).length === 0) {
          metadata = { ...(meta as MetaData) }
        }
      }
    })

    return [allTokens, metadata]
  })
}
