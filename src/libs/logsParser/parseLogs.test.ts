import { getAddress, Interface, ZeroAddress } from 'ethers'

import { getTransferLogNfts, getTransferLogTokens } from './parseLogs'

const ACCOUNT = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const RECIPIENT = '0x77777777789a8bbee6c64381e5e89e501fb0e4c8'
const UNISWAP_V3_POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
const UNISWAP_V4_POSITION_MANAGER = '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e'
const ERC20 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const erc20TransferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])
const erc721TransferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
])

const buildTransferLog = (iface: Interface, address: string, values: [string, string, bigint]) => {
  const event = iface.getEvent('Transfer')
  if (!event) throw new Error('Missing Transfer event')

  return {
    address,
    ...iface.encodeEventLog(event, values)
  }
}

describe('transfer log asset detection', () => {
  test('detects Uniswap V3 and V4 position NFT balance changes', async () => {
    const logs = [
      buildTransferLog(erc721TransferInterface, UNISWAP_V3_POSITION_MANAGER, [
        ZeroAddress,
        ACCOUNT,
        123n
      ]),
      buildTransferLog(erc721TransferInterface, UNISWAP_V4_POSITION_MANAGER, [
        ACCOUNT,
        RECIPIENT,
        456n
      ])
    ]

    await expect(getTransferLogNfts(logs, ACCOUNT)).resolves.toEqual([
      {
        address: getAddress(UNISWAP_V3_POSITION_MANAGER),
        tokenId: 123n,
        balanceChange: 1n
      },
      {
        address: getAddress(UNISWAP_V4_POSITION_MANAGER),
        tokenId: 456n,
        balanceChange: -1n
      }
    ])
  })

  test('keeps ERC-20 and ERC-721 Transfer logs separate', async () => {
    const erc20Log = buildTransferLog(erc20TransferInterface, ERC20, [
      RECIPIENT,
      ACCOUNT,
      1_000_000n
    ])
    const nftLog = buildTransferLog(erc721TransferInterface, UNISWAP_V4_POSITION_MANAGER, [
      ZeroAddress,
      ACCOUNT,
      789n
    ])

    await expect(getTransferLogTokens([erc20Log, nftLog], ACCOUNT)).resolves.toEqual([ERC20])
    await expect(getTransferLogNfts([erc20Log, nftLog], ACCOUNT)).resolves.toEqual([
      {
        address: getAddress(UNISWAP_V4_POSITION_MANAGER),
        tokenId: 789n,
        balanceChange: 1n
      }
    ])
  })

  test('ignores unrelated and malformed logs', async () => {
    const unrelatedLog = buildTransferLog(erc721TransferInterface, UNISWAP_V3_POSITION_MANAGER, [
      ZeroAddress,
      RECIPIENT,
      123n
    ])
    const malformedLog = {
      address: UNISWAP_V4_POSITION_MANAGER,
      topics: ['0x1234', '0x5678', '0x9abc', '0xdef0'],
      data: '0x'
    }

    await expect(getTransferLogNfts([unrelatedLog, malformedLog], ACCOUNT)).resolves.toEqual([])
  })

  test('nets an NFT sent out and received back in the same transaction', async () => {
    const logs = [
      buildTransferLog(erc721TransferInterface, UNISWAP_V3_POSITION_MANAGER, [
        ACCOUNT,
        RECIPIENT,
        123n
      ]),
      buildTransferLog(erc721TransferInterface, UNISWAP_V3_POSITION_MANAGER, [
        RECIPIENT,
        ACCOUNT,
        123n
      ])
    ]

    await expect(getTransferLogNfts(logs, ACCOUNT)).resolves.toEqual([])
  })
})
