import { Interface, ZeroAddress } from 'ethers'

import { describe, it } from '@jest/globals'

import { AccountOp } from '../../../accountOp/accountOp'
import { AmbireAccount } from '../../const/abis/AmbireAccount'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel } from '../../utils'
import { embeddedAmbireOperationHumanizer } from '.'

const accountAddr = '0x46C0C59591EbbD9b7994d10efF172bFB9325E240'
const accountAddr2 = '0xB2125Ae51ee5Ff91D5da625b9F1Fbf5F2941DD27'
const iface = new Interface([
  ...AmbireAccount,
  'function transfer(address recipient, uint256 amount)'
])
describe('Hidden ambire operations', () => {
  it('Ambire transactions', () => {
    const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const transactionsToWrap = [
      {
        to: USDC_ADDRESS,
        value: 0n,
        data: iface.encodeFunctionData('transfer', [ZeroAddress, 3])
      },
      {
        to: USDC_ADDRESS,
        value: 0n,
        data: iface.encodeFunctionData('transfer', [ZeroAddress, 4])
      }
    ]
    const wrappedTransactions = [
      {
        to: accountAddr,
        value: 0n,
        data: iface.encodeFunctionData('tryCatch', [
          USDC_ADDRESS,
          0n,
          iface.encodeFunctionData('transfer', [ZeroAddress, 0])
        ])
      },
      {
        to: accountAddr,
        value: 0n,
        data: iface.encodeFunctionData('tryCatchLimit', [
          USDC_ADDRESS,
          0n,
          iface.encodeFunctionData('transfer', [ZeroAddress, 1]),
          1n
        ])
      },
      {
        to: accountAddr,
        value: 0n,
        data: iface.encodeFunctionData('executeBySelfSingle', [
          [USDC_ADDRESS, 0n, iface.encodeFunctionData('transfer', [ZeroAddress, 2])]
        ])
      },
      {
        to: accountAddr,
        value: 0n,
        data: iface.encodeFunctionData('executeBySelf', [transactionsToWrap])
      },
      {
        to: accountAddr2,
        value: 0n,
        data: iface.encodeFunctionData('execute', [
          transactionsToWrap.map((i) => Object.values(i)),
          '0x1234567890123456789012345678901234567890123456789012345678901234'
        ])
      },
      {
        to: accountAddr2,
        value: 0n,
        data: iface.encodeFunctionData('executeMultiple', [
          [
            [
              transactionsToWrap.map((i) => Object.values(i)),
              '0x1234567890123456789012345678901234567890123456789012345678901234'
            ]
          ]
        ])
      },
      {
        to: accountAddr2,
        value: 0n,
        data: iface.encodeFunctionData('executeBySender', [transactionsToWrap])
      }
    ]
    const accountOp: AccountOp = {
      accountAddr,
      calls: wrappedTransactions
    } as AccountOp
    const irCalls = embeddedAmbireOperationHumanizer(
      accountOp,
      wrappedTransactions,
      {} as HumanizerMeta
    )
    expect(irCalls.length).toBe(8)
    irCalls.forEach((call: IrCall, i: number) => {
      if (i < 5) {
        expect(call.to).toBe(USDC_ADDRESS)
        expect(call.value).toBe(0n)
        // i+1 is just arbitrary value at the end
        expect(call.data).toBe(iface.encodeFunctionData('transfer', [ZeroAddress, i]))
      } else {
        expect(call.fullVisualization?.length).toBe(3)
        compareHumanizerVisualizations(
          [call],
          [[getAction('Execute calls'), getLabel('from'), getAddressVisualization(accountAddr2)]]
        )
      }
    })
  })
})
