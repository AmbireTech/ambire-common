import { countUnicodeLettersAndNumbers } from './helpers'

describe('Error decoder helpers', () => {
  it('countUnicodeLettersAndNumbers', () => {
    const result = countUnicodeLettersAndNumbers('Hello, world!')
    expect(result).toBe(10)

    // Mix of valid and invalid characters
    const result2 = countUnicodeLettersAndNumbers('Hello, world! \uD83D\uDE00')
    expect(result2).toBe(10)

    // All invalid characters
    const result3 = countUnicodeLettersAndNumbers('\uD83D\uDE00\uD83D\uDE00')
    expect(result3).toBe(0)

    const result4 = countUnicodeLettersAndNumbers('1234567890')
    expect(result4).toBe(10)

    const result5 = countUnicodeLettersAndNumbers('!@#$%^&*()')
    expect(result5).toBe(0)
  })
})
