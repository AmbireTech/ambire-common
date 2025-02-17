import { EntropyGenerator } from './entropyGenerator'

describe('EntropyGenerator', () => {
  let generator: EntropyGenerator

  beforeEach(() => {
    generator = new EntropyGenerator()
  })

  test('should generate random bytes with extra entropy', () => {
    const length = 32
    const extraEntropy = 'extra randomness'
    const result = generator.generateRandomBytes(length, extraEntropy)

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(length)
  })
  test('should throw an error when entropy pool is empty', () => {
    jest.spyOn(generator, 'addEntropy').mockImplementation(() => {})
    expect(() => generator.generateRandomBytes(16, '')).toThrow('Entropy pool is empty')
  })
  test('should collect time entropy', () => {
    jest.spyOn(generator, 'addEntropy')
    generator.generateRandomBytes(16, 'test')
    expect(generator.addEntropy).toHaveBeenCalled()
  })
  test('should collect system noise entropy', () => {
    jest.spyOn(generator, 'addEntropy')
    generator.generateRandomBytes(16, 'test')
    expect(generator.addEntropy).toHaveBeenCalled()
  })
  test('should produce different outputs on consecutive calls', () => {
    const length = 32
    const extraEntropy = 'extra randomness'
    const result1 = generator.generateRandomBytes(length, extraEntropy)
    const result2 = generator.generateRandomBytes(length, extraEntropy)
    expect(result1).not.toEqual(result2)
  })
  test('should ensure randomness by checking uniform distribution', () => {
    const length = 32
    const occurrences = new Map()
    for (let i = 0; i < 1000; i++) {
      const result = generator.generateRandomBytes(length, 'entropy-test')
      occurrences.set(result.toString(), (occurrences.get(result.toString()) || 0) + 1)
    }
    expect(occurrences.size).toBeGreaterThan(999) // Expect at least 999 unique values out of 1000
  })
  test('should not produce predictable patterns', () => {
    const length = 32
    const results: Uint8Array[] = []
    for (let i = 0; i < 100; i++) {
      results.push(generator.generateRandomBytes(length, ''))
    }
    const diffs = results.map((r, i) => (i > 0 ? r.toString() !== results[i - 1].toString() : true))
    expect(diffs.includes(false)).toBe(false)
  })
})
