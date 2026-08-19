import { describe, expect, test } from '@jest/globals'

import { AccountOp } from '../../accountOp/accountOp'
import { Call } from '../../accountOp/types'
import { humanizeCallWithErc7730 } from './humanize'
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
