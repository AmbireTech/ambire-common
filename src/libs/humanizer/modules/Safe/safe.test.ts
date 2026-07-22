import { SafeMultisigTransactionResponse } from '@safe-global/types-kit'
import { encodeFunctionData, parseAbi, zeroAddress } from 'viem'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel } from '../../utils'
import SafeModule, { getSafeHumanization } from './'

const buildSafeTxFixture = (
  overrides: Partial<SafeMultisigTransactionResponse>
): SafeMultisigTransactionResponse => ({
  safe: '0x0000000000000000000000000000000000000000',
  to: '0x0000000000000000000000000000000000000000',
  value: '0',
  operation: 0,
  gasToken: '0x0000000000000000000000000000000000000000',
  safeTxGas: '0',
  baseGas: '0',
  gasPrice: '0',
  nonce: '0',
  executionDate: null,
  submissionDate: '2024-01-01T00:00:00Z',
  modified: '2024-01-01T00:00:00Z',
  blockNumber: null,
  transactionHash: null,
  safeTxHash: '0x0',
  executor: null,
  proposer: null,
  proposedByDelegate: null,
  isExecuted: false,
  isSuccessful: null,
  ethGasPrice: null,
  maxFeePerGas: null,
  maxPriorityFeePerGas: null,
  gasUsed: null,
  fee: null,
  origin: '',
  confirmationsRequired: 1,
  trusted: true,
  signatures: null,
  ...overrides
})

const transactions = [
  {
    to: '0xF332bF49Da180E0c4814dC662d179020f31aE07D',
    value: 0n,
    data: '0x6a7612020000000000000000000000000bbbead62f7647ae8323d2cb243a0db74b7c2b800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001c00000000000000000000000000000000000000000000000000000000000000044a9059cbb0000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f49000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000820000000000000000000000004206d534CD8aCF86ba0eeC5ABb3c0B98EF7728dC000000000000000000000000000000000000000000000000000000000000000001a2df9e98285798df2bc8ba5368202ed950e153dee458fa9264dabf03722203d60a6ec8fc34f6dd0c745ef498795bf6bb00f32aec006af6fc94df3ac4b8284f1c1b000000000000000000000000000000000000000000000000000000000000'
  }
]
const delegateCallTransaction = {
  to: '0x043faB48aCC3DD066fcf33cA3e3f2E2Ba5be9018',
  value: 0n,
  data: '0x6a761202000000000000000000000000c91305dde651c899ef8ee1d0c33e7dab1b5abf0d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000025aa0f9a42ee4ea2dc7f3c9ff02f558dcb0445a3000000000000000000000000000000000000000000000000000000000000088000000000000000000000000000000000000000000000000000000000000007040c2c8750000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000000000000000000000000000000000000000044000000000000000000000000000000000000000000000000000000000000000104161766556334f70656e5265636970650000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000572000000000000000000000000d8293ad21678c6f09da139b4b62d38e514a03b780000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002710000000000000000000000000d8293ad21678c6f09da139b4b62d38e514a03b780000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64d00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002fc33bf00000000000000000000000000000000000000000000000000000000009e9290b100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041000000000000000000000000d8293ad21678c6f09da139b4b62d38e514a03b7800000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000'
}
const accountOp: AccountOp = {
  accountAddr: '0x6969174FD72466430a46e18234D0b530c9FD5f49',
  chainId: 42161n,
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  signingKeyType: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  id: 'testSafe'
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
}
describe('Safe', () => {
  test('basic', () => {
    const expectedVisualization = [
      [
        getAction('Execute a Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization('0xF332bF49Da180E0c4814dC662d179020f31aE07D'),
        getLabel('to'),
        getAddressVisualization('0x0BbbEad62f7647AE8323d2cb243A0DB74B7C2b80')
      ]
    ]
    const irCalls = transactions.map((c) =>
      SafeModule(accountOp, c, humanizerInfo as HumanizerMeta)
    )
    compareHumanizerVisualizations(irCalls, expectedVisualization)
  })

  describe('safeTx delegatecall warning', () => {
    const plainCalls = [
      { to: '0x1111111111111111111111111111111111111111', value: 0n, data: '0x' },
      { to: '0x2222222222222222222222222222222222222222', value: 0n, data: '0x' },
      { to: '0x3333333333333333333333333333333333333333', value: 0n, data: '0x' }
    ]

    // accountOp.safeTx describes the outer Safe{WALLET} execTransaction being imported/
    // co-signed, not any single call's own data, so SafeModule (a per-call humanizer module)
    // must not attach a warning to any of the individual calls for it. It is surfaced once,
    // at the accountOp level, via getSafeDelegateCallWarning (src/controllers/signAccountOp/helper.ts)
    test('never attaches a call-level warning for accountOp.safeTx, even when it is a delegatecall to an unwhitelisted contract', () => {
      const accOpWithSafeTx: AccountOp = {
        ...accountOp,
        safeTx: buildSafeTxFixture({
          operation: 1,
          to: '0x9999999999999999999999999999999999999999'
        })
      }

      const irCalls = plainCalls.map((c) =>
        SafeModule(accOpWithSafeTx, c, humanizerInfo as HumanizerMeta)
      )

      irCalls.forEach((call) => {
        expect(call.warnings?.some((w) => w.code === 'SAFE{WALLET}_DELEGATE_CALL')).toBeFalsy()
      })
    })

    test('does not warn when accountOp.safeTx is not set', () => {
      const irCalls = plainCalls.map((c) =>
        SafeModule(accountOp, c, humanizerInfo as HumanizerMeta)
      )

      irCalls.forEach((call) => {
        expect(call.warnings?.some((w) => w.code === 'SAFE{WALLET}_DELEGATE_CALL')).toBeFalsy()
      })
    })
  })

  describe('execTransaction delegatecall warning in a mixed batch', () => {
    const execTransactionAbi = parseAbi([
      'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
    ])

    const encodeExecTransaction = (to: string, operation: number) =>
      encodeFunctionData({
        abi: execTransactionAbi,
        args: [to as `0x${string}`, 0n, '0x', operation, 0n, 0n, 0n, zeroAddress, zeroAddress, '0x']
      })

    // Each call in a batch is humanized independently by SafeModule's execTransaction
    // matcher, so a delegatecall to an unwhitelisted contract must only warn on the
    // specific call that carries it, not on its sibling calls in the same batch.
    test('warns only on the call that is a delegatecall to an unwhitelisted contract, not on sibling calls', () => {
      const delegateCall = {
        to: accountOp.accountAddr,
        value: 0n,
        data: encodeExecTransaction('0x9999999999999999999999999999999999999999', 1)
      }
      const regularCall = {
        to: accountOp.accountAddr,
        value: 0n,
        data: encodeExecTransaction('0x8888888888888888888888888888888888888888', 0)
      }

      const [delegateCallResult, regularCallResult] = [delegateCall, regularCall].map((c) =>
        SafeModule(accountOp, c, humanizerInfo as HumanizerMeta)
      ) as [IrCall, IrCall]

      expect(
        delegateCallResult.warnings?.some((w) => w.code === 'SAFE{WALLET}_DELEGATE_CALL')
      ).toBe(true)
      expect(
        regularCallResult.warnings?.some((w) => w.code === 'SAFE{WALLET}_DELEGATE_CALL')
      ).toBeFalsy()
    })

    test('does not warn when the delegatecall target is whitelisted by Safe', () => {
      const delegateCallToWhitelisted = {
        to: accountOp.accountAddr,
        value: 0n,
        data: encodeExecTransaction('0xA83c336B20401Af773B6219BA5027174338D1836', 1)
      }

      const result = SafeModule(
        accountOp,
        delegateCallToWhitelisted,
        humanizerInfo as HumanizerMeta
      )

      expect(result.warnings?.some((w) => w.code === 'SAFE{WALLET}_DELEGATE_CALL')).toBeFalsy()
    })
  })

  describe('setFallbackHandler', () => {
    const setFallbackHandlerAbi = parseAbi(['function setFallbackHandler(address handler)'])

    const encode = (handler: string) =>
      encodeFunctionData({ abi: setFallbackHandlerAbi, args: [handler as `0x${string}`] })

    test('does not warn when the handler is a known Safe default (CompatibilityFallbackHandler v1.3.0)', () => {
      const result = getSafeHumanization(
        accountOp.accountAddr,
        accountOp.accountAddr,
        0n,
        encode('0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4')
      )
      expect(result?.warnings?.some((w) => w.code === 'SAFE{WALLET}_FALLBACK_HANDLER')).toBeFalsy()
    })

    test('does not warn when the handler is the zero address (disabling the fallback handler)', () => {
      const result = getSafeHumanization(
        accountOp.accountAddr,
        accountOp.accountAddr,
        0n,
        encode('0x0000000000000000000000000000000000000000')
      )
      expect(result?.warnings?.some((w) => w.code === 'SAFE{WALLET}_FALLBACK_HANDLER')).toBeFalsy()
    })

    test('warns when the handler is not a known Safe default (e.g. an ExtensibleFallbackHandler)', () => {
      const result = getSafeHumanization(
        accountOp.accountAddr,
        accountOp.accountAddr,
        0n,
        encode('0x2f55e8b20D0B9FEFA187AA7d00B6Cbe563605bF5')
      )
      expect(result?.warnings?.some((w) => w.code === 'SAFE{WALLET}_FALLBACK_HANDLER')).toBe(true)
    })
  })

  describe('setDomainVerifier', () => {
    const setDomainVerifierAbi = parseAbi([
      'function setDomainVerifier(bytes32 domainSeparator, address newVerifier)'
    ])

    test('always warns, since it grants a contract standing signature authority for a domain', () => {
      const data = encodeFunctionData({
        abi: setDomainVerifierAbi,
        args: [
          '0xd72ffa789b6fae41254d0b5a13e6e1e92ed947ec6a251edf1cf0b6c02c257b4',
          '0xfdaFc9d1902f4e0b84f65F49f244b32b31013b74'
        ]
      })
      const result = getSafeHumanization(accountOp.accountAddr, accountOp.accountAddr, 0n, data)
      expect(result?.warnings?.some((w) => w.code === 'SAFE{WALLET}_DOMAIN_VERIFIER')).toBe(true)
    })
  })
})
