import { produceMemoryStore } from '../../../../../test/helpers'
import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { ErrorRef } from '../../../../controllers/eventEmitter/eventEmitter'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerFragment, HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { parseCalls } from '../../parsers'
import { humanizerMetaParsing } from '../../parsers/humanizerMetaParsing'
import { EMPTY_HUMANIZER_META, HUMANIZER_META_KEY, integrateFragments } from '../../utils'
import { genericErc20Humanizer } from '../tokens'
import fallbackHumanizer from '.'

const mockEmitError = (e: ErrorRef) => console.log(e)

const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: 'ethereum',
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  signingKeyType: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  // This is used when we have an account recovery to finalize before executing the AccountOp,
  // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future,
  // for example account migration (from v1 QuickAcc to v2)
  accountOpToExecuteBefore: null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
}
const transactions = {
  generic: [
    // simple transafer
    { to: '0xc4ce03b36f057591b2a360d773edb9896255051e', value: BigInt(10 ** 18), data: '0x' },
    // simple contract call (WETH approve)
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000e5c783ee536cf5e63e792988335c4255169be4e1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    }
  ],
  humanizerMetatransaction: [
    // ETH to uniswap (bad example, sending eth to contract)
    {
      to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      value: BigInt(10 * 18),
      data: '0x'
    },
    // USDT to uniswap (bad example, sending erc-20 to contract)
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: '0xa9059cbb0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // ETH to random address (expects to shortened address)
    {
      to: '0x1234f3fd5f43464db0448a57529eaf37f04c1234',
      value: BigInt(10 * 18),
      data: '0x'
    }
  ],
  uniV3: [
    // Swap exact WALLET for at least x  USDC
    {
      to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c236530000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000124b858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000835074000000000000000000000000000000000000000000000000000000000000004288800092ff476844f74dc2fc427974bbee2794ae002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // Swap up to x Adex to exact DAI
    {
      to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c233bf000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012409b8134600000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea50000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000025faff1f58be30f6ec00000000000000000000000000000000000000000000000000000000000000426b175474e89094c44da98b954eedeac495271d0f000064dac17f958d2ee523a2206206994597c13d831ec7000bb8ade00c28244d5ce17d72e40330b1c318cd12b7c300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // multicall
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000124f28c0498000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000005a5be6b067d6b5b018adbcd27ee6972105b3b4000000000000000000000000000000000000000000000000000000000064d4f15700000000000000000000000000000000000000000000048a19ce0269c802800000000000000000000000000000000000000000000000000019952df3ca0a9588000000000000000000000000000000000000000000000000000000000000002b046eee2cc3188071c02bfc1745a6b17c656e3f3d000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000',
      value: BigInt(0)
    }
  ]
}
describe('fallbackHumanizer', () => {
  test('fallback', async () => {
    const storage = produceMemoryStore()
    await storage.set(HUMANIZER_META_KEY, { abis: { NO_ABI: {} }, knownAddresses: {} })
    accountOp.calls = [...transactions.generic]
    let irCalls: IrCall[] = accountOp.calls
    let asyncOps = []
    ;[irCalls, asyncOps] = fallbackHumanizer(accountOp, irCalls, EMPTY_HUMANIZER_META, {
      fetch,
      emitError: mockEmitError
    })
    asyncOps = (await Promise.all(asyncOps.map((i) => i()))).filter((a) => a) as HumanizerFragment[]
    expect(asyncOps.length).toBe(1)
    expect(asyncOps[0]).toMatchObject({ key: '0x095ea7b3' })
    ;[irCalls, asyncOps] = fallbackHumanizer(
      accountOp,
      irCalls,
      integrateFragments(EMPTY_HUMANIZER_META, asyncOps),
      { fetch }
    )
    expect(irCalls[1]?.fullVisualization?.[0]).toMatchObject({
      type: 'action',
      content: 'Call approve(address,uint256)'
    })
    expect(asyncOps.length).toBe(0)
  })

  // @TODO humanizerMetaParsing
  test('metaParsing', () => {
    accountOp.calls = [...transactions.humanizerMetatransaction]
    let irCalls = accountOp.calls
    ;[irCalls] = genericErc20Humanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    ;[irCalls] = fallbackHumanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta)
    const [newCalls] = parseCalls(
      accountOp,
      irCalls,
      [humanizerMetaParsing],
      humanizerInfo as HumanizerMeta,
      { fetch }
    )
    expect(newCalls.length).toBe(transactions.humanizerMetatransaction.length)
    expect(
      newCalls[0]?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'address')
    ).toMatchObject({
      type: 'address',
      address: expect.anything(),
      humanizerMeta: {}
    })
    expect(
      newCalls[1]?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'address')
    ).toMatchObject({
      type: 'address',
      address: expect.anything(),
      humanizerMeta: {}
    })
    expect(
      newCalls[2]?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'address')
    ).toMatchObject({
      type: 'address',
      address: expect.anything()
    })
  })
})
