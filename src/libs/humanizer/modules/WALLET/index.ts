import { Interface } from 'ethers'

import { STK_WALLET, WALLET_STAKING_ADDR, WALLET_TOKEN } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import { StkWallet } from '../../const/abis/stkWallet'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { checkIfUnknownAction, getAction, getLabel, getToken } from '../../utils'
import { StakingPools } from './stakingPools'
// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
import { WALLETSupplyControllerMapping } from './WALLETSupplyController'

const stakingAddresses = [
  '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
  '0xb6456b57f03352be48bf101b46c1752a0813491a',
  '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e'
]

const stkWalletIface = new Interface(StkWallet)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETModule: HumanizerCallModule = (_: AccountOp, irCalls: IrCall[]) => {
  const matcher = {
    supplyController: WALLETSupplyControllerMapping(),
    stakingPool: StakingPools(),
    stkWallet: {
      [stkWalletIface.getFunction('wrapAll')!.selector]: () => {
        return [
          getAction('Wrap all'),
          getToken(WALLET_STAKING_ADDR, 0n),
          getLabel('to'),
          getToken(STK_WALLET, 0n)
        ]
      },
      [stkWalletIface.getFunction('wrap')!.selector]: ({ data }: IrCall) => {
        const [shareAmount] = stkWalletIface.parseTransaction({ data })!.args

        return [
          getAction('Wrap'),
          getToken(WALLET_STAKING_ADDR, shareAmount),
          getLabel('to'),
          getToken(STK_WALLET, 0n)
        ]
      },
      [stkWalletIface.getFunction('unwrap')!.selector]: ({ data }: IrCall) => {
        const [shareAmount] = stkWalletIface.parseTransaction({ data })!.args

        return [
          getAction('Unwrap'),
          getToken(STK_WALLET, 0n),
          getLabel('for'),
          getToken(WALLET_STAKING_ADDR, shareAmount)
        ]
      },
      [stkWalletIface.getFunction('enter')!.selector]: ({ data }: IrCall) => {
        const [amount] = stkWalletIface.parseTransaction({ data })!.args

        return [
          getAction('Stake and wrap'),
          getToken(WALLET_TOKEN, amount),
          getLabel('for'),
          getToken(STK_WALLET, 0n)
        ]
      }
    }
  }
  const newCalls = irCalls.map((call: IrCall) => {
    if (
      call.to &&
      stakingAddresses.includes(call.to.toLowerCase()) &&
      (!call.fullVisualization || checkIfUnknownAction(call.fullVisualization))
    ) {
      if (matcher.stakingPool[call.data.slice(0, 10)]) {
        return {
          ...call,
          fullVisualization: matcher.stakingPool[call.data.slice(0, 10)](call)
        }
      }
    }
    if (matcher.supplyController[call.data.slice(0, 10)]) {
      return {
        ...call,
        fullVisualization: matcher.supplyController[call.data.slice(0, 10)](call)
      }
    }
    if (
      call.to &&
      call.to.toLowerCase() === STK_WALLET.toLowerCase() &&
      matcher.stkWallet[call.data.slice(0, 10)]
    ) {
      return {
        ...call,
        fullVisualization: matcher.stkWallet[call.data.slice(0, 10)](call)
      }
    }
    return call
  })
  return newCalls
}
