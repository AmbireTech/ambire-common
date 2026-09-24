import { AbiCoder, getAddress } from 'ethers'

import { expect } from '@jest/globals'

import { PrivacyPoolsPaymasterConfig } from '../../interfaces/privacyPools'
import {
  PrivacyPoolsPaymasterWithdrawalPayload,
  readPaymasterWithdrawal
} from './paymasterWithdrawal'

const RECIPIENT = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
const ATTACKER = getAddress('0x0000000000000000000000000000000000000bad')
const POOL = '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb'
const ADAPTER = getAddress('0x0a230D83f16209E2692494a0ae139aAD8C96bde9')
const PAYMASTER = getAddress('0xe06CB96C57D2442f8F60F5017354BC08F7e91308')
const ENTRY_POINT = getAddress('0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108')

const AMOUNT = 10n ** 18n
const FEE = 10n ** 15n

const PAYMASTER_CONFIG: PrivacyPoolsPaymasterConfig = {
  entryPointAddress: ENTRY_POINT,
  paymasterAddress: PAYMASTER,
  poolAdapters: { [POOL]: ADAPTER }
}

const coder = AbiCoder.defaultAbiCoder()

const encodePaymasterData = ({
  adapter = ADAPTER,
  processooor = ADAPTER,
  recipient = RECIPIENT,
  feeRecipient = PAYMASTER,
  fee = FEE,
  withdrawnValue = AMOUNT
}: {
  adapter?: string
  processooor?: string
  recipient?: string
  feeRecipient?: string
  fee?: bigint
  withdrawnValue?: bigint
} = {}) => {
  const data = coder.encode(
    ['tuple(address recipient, address feeRecipient, uint256 fee)'],
    [{ recipient, feeRecipient, fee }]
  )
  const adapterData = coder.encode(
    [
      'tuple(tuple(address processooor, bytes data) withdrawal, tuple(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
    ],
    [
      {
        withdrawal: { processooor, data },
        proof: {
          pA: [1n, 2n],
          pB: [
            [3n, 4n],
            [5n, 6n]
          ],
          pC: [7n, 8n],
          pubSignals: [11n, 12n, withdrawnValue, 14n, 15n, 16n, 17n, 18n]
        }
      }
    ]
  )

  return coder.encode(['tuple(address adapter, bytes adapterData)'], [{ adapter, adapterData }])
}

const buildWithdrawal = (
  overrides: Partial<PrivacyPoolsPaymasterWithdrawalPayload> = {},
  paymasterData = encodePaymasterData()
): PrivacyPoolsPaymasterWithdrawalPayload => ({
  poolAddress: BigInt(POOL),
  paymasterAddress: PAYMASTER,
  entryPointAddress: ENTRY_POINT,
  userOperation: { paymaster: PAYMASTER, paymasterData },
  ...overrides
})

const read = (withdrawal: PrivacyPoolsPaymasterWithdrawalPayload, recipient = RECIPIENT) =>
  readPaymasterWithdrawal({ withdrawal, paymaster: PAYMASTER_CONFIG, recipient, amount: AMOUNT })

describe('libs/privacyPools/paymasterWithdrawal', () => {
  it('returns the fee of a withdrawal that matches the request', () => {
    expect(read(buildWithdrawal())).toEqual({ fee: FEE })
  })

  it('accepts a recipient that differs only in checksum casing', () => {
    expect(read(buildWithdrawal(), RECIPIENT.toLowerCase())).toEqual({ fee: FEE })
  })

  it('refuses a withdrawal that pays out to another address', () => {
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ recipient: ATTACKER })))).toThrow(
      /different address/
    )
  })

  it('refuses a withdrawal whose fee goes to someone other than the paymaster', () => {
    expect(() =>
      read(buildWithdrawal({}, encodePaymasterData({ feeRecipient: ATTACKER })))
    ).toThrow(/fee goes to an unexpected address/)
  })

  it('refuses a withdrawal routed through another adapter', () => {
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ processooor: ATTACKER })))).toThrow(
      /unexpected adapter/
    )
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ adapter: ATTACKER })))).toThrow(
      /unexpected adapter/
    )
  })

  it('refuses a withdrawal sponsored by another paymaster', () => {
    expect(() =>
      read(
        buildWithdrawal({
          userOperation: { paymaster: ATTACKER, paymasterData: encodePaymasterData() }
        })
      )
    ).toThrow(/unexpected paymaster/)
  })

  it('refuses a withdrawal sent to another entry point', () => {
    expect(() => read(buildWithdrawal({ entryPointAddress: ATTACKER }))).toThrow(
      /unexpected ERC-4337 entry point/
    )
  })

  it('refuses a pool with no configured adapter', () => {
    expect(() => read(buildWithdrawal({ poolAddress: BigInt(ATTACKER) }))).toThrow(
      /no paymaster adapter/
    )
  })

  it('refuses a proof over a different amount', () => {
    expect(() =>
      read(buildWithdrawal({}, encodePaymasterData({ withdrawnValue: AMOUNT + 1n })))
    ).toThrow(/different amount/)
  })

  it('refuses a fee that takes the whole amount', () => {
    expect(() => read(buildWithdrawal({}, encodePaymasterData({ fee: AMOUNT })))).toThrow(
      /whole amount/
    )
  })
})
