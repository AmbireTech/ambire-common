import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { toMapTokenHints, toMapTokenNetwork } from './tokenProcessing'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!

// Anything handed to an offloaded task is marked as serialized by the worklet
// runtime, and the owner mutating it afterwards warns and may not be seen on the
// other side. Network and the hint lists are both controller-owned and mutated
// during a session, so these projections must hand over copies, never the
// originals. See src/libs/offload/README.md.

describe('toMapTokenNetwork', () => {
  test('returns a new object rather than the network it was given', () => {
    const projected = toMapTokenNetwork(ethereum)

    expect(projected).not.toBe(ethereum)
    expect(projected.chainId).toBe(ethereum.chainId)
    expect(projected.name).toBe(ethereum.name)
    expect(projected.nativeAssetName).toBe(ethereum.nativeAssetName)
    expect(projected.nativeAssetSymbol).toBe(ethereum.nativeAssetSymbol)
  })

  test('carries none of the mutable fields the networks controller writes to', () => {
    const projected = toMapTokenNetwork(ethereum) as Record<string, unknown>

    // features is reassigned by the networks controller after a network is
    // built, which is exactly what triggered the serialized-object warning
    expect(projected).not.toHaveProperty('features')
    expect(Object.keys(projected).sort()).toEqual([
      'chainId',
      'name',
      'nativeAssetName',
      'nativeAssetSymbol'
    ])
  })
})

describe('toMapTokenHints', () => {
  test('copies every list instead of sharing the caller arrays', () => {
    const hints = { custom: ['0xa'], hidden: ['0xb'], learn: ['0xc'] }
    const projected = toMapTokenHints(hints)!

    expect(projected).not.toBe(hints)
    expect(projected.custom).not.toBe(hints.custom)
    expect(projected.hidden).not.toBe(hints.hidden)
    expect(projected.learn).not.toBe(hints.learn)
    expect(projected).toEqual(hints)
  })

  test('a later write to the original list does not reach the copy', () => {
    const hints = { custom: ['0xa'], hidden: [], learn: [] }
    const projected = toMapTokenHints(hints)!

    hints.custom.push('0xlater')

    expect(projected.custom).toEqual(['0xa'])
  })

  test('passes undefined through, since the hints are optional', () => {
    expect(toMapTokenHints(undefined)).toBeUndefined()
  })
})
