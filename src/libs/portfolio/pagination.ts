export function paginate(input: any[], limit: number): any[][] {
  const pages = []
  let from = 0
  for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
    pages.push(input.slice(from, i * limit))
    from += limit
  }
  return pages
}

export function flattenResults(everything: Promise<any[]>[]): Promise<any[]> {
  return Promise.all(everything)
    .then((results) => {
      if (!results || !results.length) {
        return [[], {}]
      }

      const allTokens: any[] = []
      let metadata: Record<string, any> = {}

      results.forEach((result) => {
        if (Array.isArray(result) && result.length > 0) {
          const [tokensArray, meta] = result
          if (Array.isArray(tokensArray)) {
            allTokens.push(...tokensArray)
          }
          metadata = { ...meta }
        }
      })

      return [allTokens, metadata]
    })
    .catch((e) => {
      console.log('Error while flattening results:', e)
      return [[], {}]
    })
}
