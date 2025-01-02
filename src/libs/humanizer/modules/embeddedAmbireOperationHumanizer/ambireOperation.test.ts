import { Interface, ZeroAddress } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import { HumanizerMeta, IrCall } from 'libs/humanizer/interfaces'

import { describe, it } from '@jest/globals'

import { AmbireAccount } from '../../const/abis/AmbireAccount'
import { embeddedAmbireOperationHumanizer } from '.'

const accountAddr = '0x46C0C59591EbbD9b7994d10efF172bFB9325E240'
const iface = new Interface([
  ...AmbireAccount,
  'function transfer(address recipient, uint256 amount)'
])
describe('Legends', () => {
  it('Linking, both invitation and no invitation', () => {
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
          iface.encodeFunctionData('transfer', [ZeroAddress, 1])
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
    expect(irCalls.length).toBe(4)
    irCalls.forEach((call: IrCall, i: number) => {
      expect(call.to).toBe(USDC_ADDRESS)
      expect(call.value).toBe(0n)
      // i+1 is just arbitrary value at the end
      expect(call.data).toBe(iface.encodeFunctionData('transfer', [ZeroAddress, i + 1]))
    })
  })
})
