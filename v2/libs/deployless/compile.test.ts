import { compile } from './compile'
import { describe, expect, test } from '@jest/globals'

describe('Compile', () => {
  test('should compile a contract', async () => {
    const json = await compile('AmbireAccount')
    expect(json).toHaveProperty('abi')
    expect(json).toHaveProperty('bytecode')
    expect(json).toHaveProperty('deployBytecode')
    expect(json.abi).not.toBe(null)
    expect(json.bytecode).not.toBe(null)
    expect(json.deployBytecode).not.toBe(null)
  })
})
