import { AbiCoder, Interface } from 'ethers'

import { TORNADO_CASH_PAYMASTER, TORNADO_CASH_POOLS } from '../../consts/tornadoCash'
import { TornadoCashPaymasterWithdrawal } from '../../interfaces/tornadoCash'
import {
  readTornadoCashPaymasterWithdrawal,
  TORNADO_CASH_SIMPLE_7702_IMPLEMENTATION
} from './paymasterWithdrawal'

const abiCoder = AbiCoder.defaultAbiCoder()
const ETH = '0x0000000000000000000000000000000000000000'
const ETHER = 10n ** 18n
const RECIPIENT = '0x00000000000000000000000000000000000000aa'
const SENDER = '0x00000000000000000000000000000000000000bb'
const ATTACKER = '0x00000000000000000000000000000000000000cc'
const FEE = ETHER / 1000n

const ethPool = (denomination: bigint) =>
  TORNADO_CASH_POOLS.find(
    (pool) => pool.assetAddress === ETH && pool.denomination === denomination
  )!

const ACCOUNT_INTERFACE = new Interface([
  'function executeBatch((address target, uint256 value, bytes data)[] calls)'
])
const POOL_INTERFACE = new Interface([
  'function withdraw(bytes _proof, bytes32 _root, bytes32 _nullifierHash, address _recipient, address _relayer, uint256 _fee, uint256 _refund)'
])

const paymasterData = ({
  adapter = ethPool(ETHER).feeAdapterAddress,
  recipient = RECIPIENT,
  relayer = TORNADO_CASH_PAYMASTER.paymasterAddress,
  fee = FEE
}: { adapter?: string; recipient?: string; relayer?: string; fee?: bigint } = {}) =>
  abiCoder.encode(
    ['(address adapter, bytes adapterData)'],
    [
      {
        adapter,
        adapterData: abiCoder.encode(
          [
            '(bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, address relayer, uint256 fee, uint256 refund)'
          ],
          [
            {
              proof: '0x01',
              root: `0x${'11'.repeat(32)}`,
              nullifierHash: `0x${'22'.repeat(32)}`,
              recipient,
              relayer,
              fee,
              refund: 0n
            }
          ]
        )
      }
    ]
  ) as `0x${string}`

const withdrawal = ({
  callData = '0x',
  data = paymasterData()
}: { callData?: string; data?: `0x${string}` } = {}): TornadoCashPaymasterWithdrawal => ({
  poolAddress: ethPool(ETHER).address,
  entryPointAddress: TORNADO_CASH_PAYMASTER.entryPointAddress,
  userOperation: {
    sender: SENDER,
    nonce: '0x0',
    callData: callData as `0x${string}`,
    callGasLimit: '0x0',
    verificationGasLimit: '0x0',
    preVerificationGas: '0x0',
    maxFeePerGas: '0x0',
    maxPriorityFeePerGas: '0x0',
    paymaster: TORNADO_CASH_PAYMASTER.paymasterAddress,
    paymasterData: data,
    signature: '0x',
    eip7702Auth: {
      address: TORNADO_CASH_SIMPLE_7702_IMPLEMENTATION,
      chainId: '0x1',
      nonce: '0x0',
      r: '0x0',
      s: '0x0',
      yParity: '0x0'
    }
  }
})

/** A batch of the sponsored 1 ETH note and a 0.1 ETH one, forwarding `forwardValue` to `to`. */
const batch = (to: string, forwardValue: bigint) =>
  withdrawal({
    data: paymasterData({ recipient: SENDER }),
    callData: ACCOUNT_INTERFACE.encodeFunctionData('executeBatch', [
      [
        {
          target: ethPool(ETHER / 10n).address,
          value: 0n,
          data: POOL_INTERFACE.encodeFunctionData('withdraw', [
            '0x01',
            `0x${'33'.repeat(32)}`,
            `0x${'44'.repeat(32)}`,
            SENDER,
            ETH,
            0n,
            0n
          ])
        },
        { target: to, value: forwardValue, data: '0x' }
      ]
    ])
  })

describe('readTornadoCashPaymasterWithdrawal', () => {
  it('reads a one-note withdrawal paid straight to the recipient', () => {
    expect(
      readTornadoCashPaymasterWithdrawal({
        withdrawal: withdrawal(),
        assetAddress: ETH,
        recipient: RECIPIENT
      })
    ).toMatchObject({ amount: ETHER, fee: FEE, recipientReceives: ETHER - FEE })
  })

  it('reads a batch that forwards every note, minus the fee, to the recipient', () => {
    const total = ETHER + ETHER / 10n

    expect(
      readTornadoCashPaymasterWithdrawal({
        withdrawal: batch(RECIPIENT, total - FEE),
        assetAddress: ETH,
        recipient: RECIPIENT
      })
    ).toMatchObject({ amount: total, fee: FEE, recipientReceives: total - FEE })
  })

  it('refuses a withdrawal that pays anyone but the recipient and the paymaster', () => {
    const refused = [
      withdrawal({ data: paymasterData({ recipient: ATTACKER }) }),
      withdrawal({ data: paymasterData({ relayer: ATTACKER }) }),
      withdrawal({ data: paymasterData({ adapter: ethPool(ETHER / 10n).feeAdapterAddress }) }),
      withdrawal({ data: paymasterData({ fee: ETHER }) }),
      batch(ATTACKER, ETHER + ETHER / 10n - FEE),
      batch(RECIPIENT, ETHER / 2n)
    ]

    refused.forEach((refusedWithdrawal) => {
      expect(() =>
        readTornadoCashPaymasterWithdrawal({
          withdrawal: refusedWithdrawal,
          assetAddress: ETH,
          recipient: RECIPIENT
        })
      ).toThrow('tornadoCash: the withdrawal')
    })
  })
})
