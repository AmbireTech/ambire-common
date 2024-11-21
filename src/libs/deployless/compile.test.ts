import { describe, expect, test } from '@jest/globals'

import { compile } from './compile'

describe('Compile', () => {
  test('should compile a contract', async () => {
    const json = compile('AmbireAccount')
    expect(json).toHaveProperty('abi')
    expect(json).toHaveProperty('bin')
    expect(json).toHaveProperty('binRuntime')
    expect(json.abi).not.toBe(null)
    expect(json.bin).not.toBe(null)
    expect(json.binRuntime).not.toBe(null)
  })
})
