import { encodeFunctionData, parseAbi } from 'viem'

import CowSwapModule from '.'
import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getDeadline, getLabel, getToken } from '../../utils'

const cowSwapSettlement = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
const accountAddr = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
const sellToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const buyToken = '0x63706e401c06ac8513145b7687a14804d17f814b'
const sellAmount = 934812n
const buyAmount = 10404139468585152n
const feeAmount = 1000n
const validTo = 1783581106n
const orderUid =
  `0x${'11'.repeat(32)}${accountAddr.slice(2)}${validTo.toString(16).padStart(8, '0')}` as const
const tradeTuple =
  '(uint256 sellTokenIndex,uint256 buyTokenIndex,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,uint256 flags,uint256 executedAmount,bytes signature)'
const swapAbi = parseAbi([
  `function swap((bytes32 poolId,uint256 assetIn,uint256 assetOut,uint256 amount,bytes userData)[] swaps,address[] tokens,${tradeTuple} order)`
])
const settleAbi = parseAbi([
  `function settle(address[] tokens,uint256[] clearingPrices,${tradeTuple}[] trades,(address target,uint256 value,bytes callData)[][3] interactions)`
])
const setPreSignatureAbi = parseAbi(['function setPreSignature(bytes orderUid,bool signed)'])
const invalidateOrderAbi = parseAbi(['function invalidateOrder(bytes orderUid)'])

const accountOp: AccountOp = {
  accountAddr,
  chainId: 8453n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
} as any
const cowSwapOrder = {
  sellTokenIndex: 0n,
  buyTokenIndex: 1n,
  receiver: accountAddr,
  sellAmount,
  buyAmount,
  validTo: Number(validTo),
  appData: '0x767a9774c9a589f88b23530486fb7d8836613b44a3e82e01ba1351e9c68584b2',
  feeAmount,
  flags: 0n,
  executedAmount: sellAmount,
  signature: '0x'
}
const cowSwapOrderWithoutFee = { ...cowSwapOrder, feeAmount: 0n }

describe('CowSwap', () => {
  test('humanizes swap and settle transactions', () => {
    const transactions = [
      {
        to: cowSwapSettlement,
        value: 0n,
        data: encodeFunctionData({
          abi: swapAbi,
          functionName: 'swap',
          args: [[], [sellToken, buyToken], cowSwapOrderWithoutFee]
        })
      },
      {
        to: cowSwapSettlement,
        value: 0n,
        data: encodeFunctionData({
          abi: settleAbi,
          functionName: 'settle',
          args: [[sellToken, buyToken], [1n, 1n], [cowSwapOrder], [[], [], []]]
        })
      }
    ]

    const irCalls = CowSwapModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, [
      [
        getAction('Swap'),
        getToken(sellToken, sellAmount, 8453n),
        getLabel('for at least'),
        getToken(buyToken, buyAmount, 8453n),
        getDeadline(validTo)
      ],
      [
        getAction('Settle CowSwap order'),
        getToken(sellToken, sellAmount, 8453n),
        getLabel('for at least'),
        getToken(buyToken, buyAmount, 8453n),
        getLabel('including fee'),
        getToken(sellToken, feeAmount, 8453n),
        getDeadline(validTo)
      ]
    ])
  })

  test('humanizes pre-sign and cancel order transactions', () => {
    const transactions = [
      {
        to: cowSwapSettlement,
        value: 0n,
        data: encodeFunctionData({
          abi: setPreSignatureAbi,
          functionName: 'setPreSignature',
          args: [orderUid, true]
        })
      },
      {
        to: cowSwapSettlement,
        value: 0n,
        data: encodeFunctionData({
          abi: invalidateOrderAbi,
          functionName: 'invalidateOrder',
          args: [orderUid]
        })
      }
    ]
    const orderUidVisualization = [
      getLabel(`with order ID ${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`),
      getDeadline(validTo)
    ]

    const irCalls = CowSwapModule(accountOp, transactions, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, [
      [getAction('Pre-sign CowSwap order'), ...orderUidVisualization],
      [getAction('Cancel CowSwap order'), ...orderUidVisualization]
    ])
  })
})
