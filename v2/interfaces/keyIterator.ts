export interface KeyIterator {
  retrieve: (from: number, to: number, derivation: string) => string[]
}
