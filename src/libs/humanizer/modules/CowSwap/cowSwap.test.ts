import { encodeFunctionData, parseAbi } from 'viem'

import CowSwapModule from '.'
import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken
} from '../../utils'

const cowSwapSettlement = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
const composableCow = '0xfdafc9d1902f4e0b84f65f49f244b32b31013b74'
const twapHandler = '0x6cf1e9ca41f7611def408122793c358a3d11e5a5'
const conditionalOrderParamsTuple = '(address handler,bytes32 salt,bytes staticInput) params'
const createAbi = parseAbi([`function create(${conditionalOrderParamsTuple}, bool dispatch)`])
const createWithContextAbi = parseAbi([
  `function createWithContext(${conditionalOrderParamsTuple}, address factory, bytes data, bool dispatch)`
])
const twapStaticInputAbi = parseAbi([
  'function twap(address sellToken,address buyToken,address receiver,uint256 partSellAmount,uint256 minPartLimit,uint256 t0,uint256 n,uint256 t,uint256 span,bytes32 appData)'
])
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

    const irCalls = transactions.map((c) =>
      CowSwapModule(accountOp, c, humanizerInfo as HumanizerMeta)
    )
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

    const irCalls = transactions.map((c) =>
      CowSwapModule(accountOp, c, humanizerInfo as HumanizerMeta)
    )
    compareHumanizerVisualizations(irCalls, [
      [getAction('Pre-sign CowSwap order'), ...orderUidVisualization],
      [getAction('Cancel CowSwap order'), ...orderUidVisualization]
    ])
  })

  describe('ComposableCoW conditional orders', () => {
    test('humanizes createWithContext for a real TWAP order on Base', () => {
      // captured on-chain call: sell 2.1 USDC for ETH on Base, split into 2 parts every 30 minutes
      const data =
        '0x0d0d9800000000000000000000000000000000000000000000000000000000000000008000000000000000000000000052ed56da04309aca4c3fecc595298d80c2f16bac000000000000000000000000000000000000000000000000000000000000024000000000000000000000000000000000000000000000000000000000000000010000000000000000000000006cf1e9ca41f7611def408122793c358a3d11e5a50000000000000000000000000000000000000000000000000000019f7fe0854200000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000140000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000f332bf49da180e0c4814dc662d179020f31ae07d00000000000000000000000000000000000000000000000000000000001005900000000000000000000000000000000000000000000000000001c9c0259f3c4f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000007080000000000000000000000000000000000000000000000000000000000000000d1735c8b769e3b06acd45b0c09c76b4961b8215a15d6eaeefa05593ab38215650000000000000000000000000000000000000000000000000000000000000000'
      const receiver = '0xf332bf49da180e0c4814dc662d179020f31ae07d'
      const sellToken = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
      const nativeEth = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

      const irCall = CowSwapModule(
        { ...accountOp, accountAddr: receiver },
        { to: composableCow, value: 0n, data },
        humanizerInfo as HumanizerMeta
      )

      compareHumanizerVisualizations(
        [irCall],
        [
          [
            getAction('Create CoW TWAP order'),
            getToken(sellToken, 2100000n, 8453n),
            getLabel('for at least'),
            getToken(nativeEth, 1006604157614238n, 8453n),
            getLabel('split into 2 parts, once every 30 minutes')
          ]
        ]
      )
    })

    test('humanizes create for a TWAP order, including the recipient when it differs from the account', () => {
      const twapSellToken = '0xf6bd93d90e8c1cf65fb5c7fd6e9c46c46e59c46c'
      const twapBuyToken = '0x63706e401c06ac8513145b7687a14804d17f814b'
      const twapReceiver = '0x0f5ce9ee0d6c8b41cd6d1e0e5c1c8c7f1a1b2c3d'
      const partSellAmount = 500000n
      const minPartLimit = 100n
      const t = 3600n
      const n = 4n
      const staticInput = `0x${encodeFunctionData({
        abi: twapStaticInputAbi,
        functionName: 'twap',
        args: [
          twapSellToken,
          twapBuyToken,
          twapReceiver,
          partSellAmount,
          minPartLimit,
          0n,
          n,
          t,
          0n,
          `0x${'11'.repeat(32)}` as `0x${string}`
        ]
      }).slice(10)}` as `0x${string}`

      const data = encodeFunctionData({
        abi: createAbi,
        functionName: 'create',
        args: [{ handler: twapHandler, salt: `0x${'22'.repeat(32)}`, staticInput }, true]
      })

      const irCall = CowSwapModule(
        accountOp,
        { to: composableCow, value: 0n, data },
        humanizerInfo as HumanizerMeta
      )

      compareHumanizerVisualizations(
        [irCall],
        [
          [
            getAction('Create CoW TWAP order'),
            getToken(twapSellToken, partSellAmount * n, 8453n),
            getLabel('for at least'),
            getToken(twapBuyToken, minPartLimit * n, 8453n),
            getLabel('split into 4 parts, once every 1 hour'),
            ...getRecipientText(accountAddr, twapReceiver)
          ]
        ]
      )
    })

    test('humanizes createWithContext for an unrecognized conditional order handler', () => {
      const unknownHandler = '0x1111111111111111111111111111111111111111'
      const data = encodeFunctionData({
        abi: createWithContextAbi,
        functionName: 'createWithContext',
        args: [
          { handler: unknownHandler, salt: `0x${'33'.repeat(32)}`, staticInput: '0x1234' },
          '0x0000000000000000000000000000000000000000',
          '0x',
          true
        ]
      })

      const irCall = CowSwapModule(
        accountOp,
        { to: composableCow, value: 0n, data },
        humanizerInfo as HumanizerMeta
      )

      compareHumanizerVisualizations(
        [irCall],
        [
          [
            getAction('Create CoW conditional order'),
            getLabel('via'),
            getAddressVisualization(unknownHandler)
          ]
        ]
      )
    })
  })
})
