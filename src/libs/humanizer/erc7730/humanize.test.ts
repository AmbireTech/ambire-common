import { describe, expect, test } from '@jest/globals'

import { encodeFunctionData, maxUint256, parseAbi } from 'viem'

import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { getUnlimitedApprovalWarning, UNLIMITED_APPROVAL_WARNING_CODE } from '../utils'
import { humanizeCallWithErc7730 } from './humanize'
import { MULTICALL_DESCRIPTOR } from './multicall'
import { Erc7730Descriptor } from './types'

const STEAK_USDC_VAULT = '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183'
const USDC_ON_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const RECEIVER = '0x998f31d7403db347aed69186421e52ece492b36f'

// Mirrors registry/morpho/calldata-steakhouse_financial-steakUSDC.json merged with the
// ercs/calldata-erc4626-vaults.json file it includes
const erc4626VaultDescriptor: Erc7730Descriptor = {
  metadata: {
    constants: {
      underlyingToken: USDC_ON_BASE,
      underlyingTicker: 'USDC',
      vaultTicker: 'steakUSDC'
    }
  },
  display: {
    formats: {
      'deposit(uint256 assets, address receiver)': {
        intent: 'Deposit',
        fields: [
          {
            path: 'assets',
            label: 'Deposit asset',
            format: 'tokenAmount',
            params: { token: '$.metadata.constants.underlyingToken' },
            visible: 'always'
          },
          {
            label: 'Share ticker',
            format: 'raw',
            value: '$.metadata.constants.vaultTicker'
          },
          {
            path: 'receiver',
            label: 'Send shares to',
            format: 'addressName',
            params: { types: ['eoa', 'contract'] },
            visible: 'always'
          }
        ]
      }
    }
  }
}

const depositCall: Call = {
  to: STEAK_USDC_VAULT,
  value: 0n,
  data: '0x6e553f6500000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000998f31d7403db347aed69186421e52ece492b36f'
}

describe('ERC-7730 descriptor path values', () => {
  test('resolves a field value that references a constant of the descriptor', () => {
    const humanizedCall = humanizeCallWithErc7730(
      depositCall,
      8453n as AccountOp['chainId'],
      RECEIVER,
      {
        descriptor: erc4626VaultDescriptor,
        path: 'registry/morpho/calldata-steakhouse_financial-steakUSDC.json'
      },
      'ETH'
    )
    const rows = humanizedCall?.fullVisualization?.[0].rows

    expect(rows?.[1].label).toBe('Share ticker')
    expect(rows?.[1].value[0]).toMatchObject({ type: 'text', content: 'steakUSDC' })
  })

  test('keeps a literal field value as it is', () => {
    const descriptorWithLiteralValue: Erc7730Descriptor = {
      ...erc4626VaultDescriptor,
      display: {
        formats: {
          'deposit(uint256 assets, address receiver)': {
            intent: 'Deposit',
            fields: [{ label: 'Share ticker', format: 'raw', value: 'steakUSDC' }]
          }
        }
      }
    }
    const humanizedCall = humanizeCallWithErc7730(
      depositCall,
      8453n as AccountOp['chainId'],
      RECEIVER,
      { descriptor: descriptorWithLiteralValue },
      'ETH'
    )
    const rows = humanizedCall?.fullVisualization?.[0].rows

    expect(rows?.[0].value[0]).toMatchObject({ type: 'text', content: 'steakUSDC' })
  })
})

describe('warnings from nested calls', () => {
  const approveAbi = parseAbi(['function approve(address spender, uint256 amount)'])
  const multicallAbi = parseAbi(['function multicall(bytes[] data)'])
  const usdt = '0xdac17f958d2ee523a2206206994597c13d831ec7'
  const spender = '0x46705dfff24256421a05d056c29e81bdc09723b8'
  const otherSpender = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

  // A nested call becomes a row, and a row cannot hold a warning, so the warnings the modules
  // find while decoding the inner calls have to travel up to the call the user actually signs.
  const humanizeMulticall = (approvals: { amount: bigint; spender?: string }[]) => {
    const innerCalls = approvals.map(({ amount, spender: innerSpender }) =>
      encodeFunctionData({
        abi: approveAbi,
        args: [(innerSpender || spender) as `0x${string}`, amount]
      })
    )
    const call: Call = {
      to: usdt,
      value: 0n,
      data: encodeFunctionData({ abi: multicallAbi, args: [innerCalls] })
    }

    return humanizeCallWithErc7730(call, 1n as AccountOp['chainId'], RECEIVER, MULTICALL_DESCRIPTOR)
  }

  test('reports an unlimited approval hidden inside a multicall', () => {
    const humanizedCall = humanizeMulticall([{ amount: maxUint256 }])

    expect(humanizedCall?.warnings).toEqual([getUnlimitedApprovalWarning(spender)])
  })

  test('stays quiet when the approval inside the multicall has a limit', () => {
    const humanizedCall = humanizeMulticall([{ amount: 10n ** 18n }])

    expect(humanizedCall?.warnings).toEqual([])
  })

  test('reports the unlimited approval even when other calls surround it', () => {
    const humanizedCall = humanizeMulticall([{ amount: 10n ** 18n }, { amount: maxUint256 }])

    expect(humanizedCall?.warnings).toEqual([getUnlimitedApprovalWarning(spender)])
  })

  test('reports one warning for two unlimited approvals to the same spender', () => {
    const humanizedCall = humanizeMulticall([{ amount: maxUint256 }, { amount: maxUint256 }])

    expect(humanizedCall?.warnings).toEqual([getUnlimitedApprovalWarning(spender)])
  })

  test('reports both spenders when they differ', () => {
    const humanizedCall = humanizeMulticall([
      { amount: maxUint256 },
      { amount: maxUint256, spender: otherSpender }
    ])

    expect(humanizedCall?.warnings).toEqual([
      getUnlimitedApprovalWarning(spender),
      getUnlimitedApprovalWarning(otherSpender)
    ])
  })

  test('still shows the nested approval itself', () => {
    const humanizedCall = humanizeMulticall([{ amount: maxUint256 }])
    const multicallVisualization = humanizedCall?.fullVisualization?.[0]
    if (multicallVisualization?.type !== 'erc7730') throw new Error('expected an ERC-7730 result')

    expect(multicallVisualization.rows[0]?.value[0]).toMatchObject({
      type: 'erc7730',
      title: 'Grant approval'
    })
  })

  test('a multicall with no approval carries no approval warning', () => {
    const call: Call = {
      to: usdt,
      value: 0n,
      data: encodeFunctionData({
        abi: multicallAbi,
        args: [[encodeFunctionData({ abi: approveAbi, args: [spender as `0x${string}`, 0n] })]]
      })
    }
    const humanizedCall = humanizeCallWithErc7730(
      call,
      1n as AccountOp['chainId'],
      RECEIVER,
      MULTICALL_DESCRIPTOR
    )

    expect(humanizedCall?.warnings?.some((w) => w.code === UNLIMITED_APPROVAL_WARNING_CODE)).toBe(
      false
    )
  })
})
