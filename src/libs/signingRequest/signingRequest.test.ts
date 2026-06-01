import { TypedDataEncoder, ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Hex } from '../../interfaces/hex'
import { SafeTx } from '../../interfaces/safe'
import { getSafeTxnHash } from '../safe/safe'
import { getSafeTypedData } from '../signMessage/signMessage'
import { getEIP712SigningRequest, getSigningRequestDisplayData } from './signingRequest'

const safeAddr = '0x1111111111111111111111111111111111111111' as Hex
const safeTxn: SafeTx = {
  to: '0x2222222222222222222222222222222222222222',
  value: '0x01',
  data: '0x',
  operation: 0,
  safeTxGas: '0x00',
  baseGas: '0x00',
  gasPrice: '0x00',
  gasToken: ZeroAddress as Hex,
  refundReceiver: ZeroAddress as Hex,
  nonce: '0x02'
}

describe('signing request display data', () => {
  test('includes the Safe transaction and EIP-712 hashes in a serializable preview', () => {
    const typedData = getSafeTypedData(1n, safeAddr, safeTxn)
    const safeTxHash = getSafeTxnHash(typedData)
    const displayData = getSigningRequestDisplayData(
      getEIP712SigningRequest({ ...typedData, safeTxHash })
    )
    const typesWithoutDomain = Object.fromEntries(
      Object.entries(typedData.types).filter(([typeName]) => typeName !== 'EIP712Domain')
    )

    expect(displayData).toEqual({
      ...typedData,
      safeTxHash,
      domainHash: TypedDataEncoder.hashDomain(typedData.domain),
      messageHash: TypedDataEncoder.hashStruct(
        typedData.primaryType,
        typesWithoutDomain,
        typedData.message
      )
    })
    expect(() => JSON.stringify(displayData)).not.toThrow()
  })
})
