import { describe, expect, jest, test } from '@jest/globals'

import { PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE, withCancellableProving } from './prover'

const createProver = () => {
  const prove = jest.fn(async () => ({}) as any)

  return { prove, proverFactory: async () => ({ prove }) }
}

describe('withCancellableProving', () => {
  test('cancels only the proofs of the circuit whose operation was cancelled', async () => {
    const { prove, proverFactory } = createProver()
    const withdrawal = new AbortController()
    const factory = withCancellableProving(proverFactory, (circuit) =>
      circuit === 'withdraw' ? withdrawal.signal : null
    )
    const prover = await factory()

    withdrawal.abort()

    await expect(prover.prove('withdraw', {} as any)).rejects.toThrow(
      PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE
    )
    await expect(prover.prove('commitment', {} as any)).resolves.toEqual({})
    expect(prove).toHaveBeenCalledTimes(1)
    expect(prove).toHaveBeenCalledWith('commitment', {}, { signal: undefined })
  })

  test('drops the result of a proof cancelled while it ran', async () => {
    const withdrawal = new AbortController()
    const prove = jest.fn(async () => {
      withdrawal.abort()
      return {} as any
    })
    const factory = withCancellableProving(
      async () => ({ prove }),
      () => withdrawal.signal
    )
    const prover = await factory()

    await expect(prover.prove('withdraw', {} as any)).rejects.toThrow(
      PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE
    )
    expect(prove).toHaveBeenCalledWith('withdraw', {}, { signal: withdrawal.signal })
  })
})
