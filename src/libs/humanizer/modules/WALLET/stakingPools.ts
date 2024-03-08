import { ethers } from 'ethers'
import { getAction, getLabel, getToken, getAddressVisualization, getKnownAbi } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

const STAKING_POOLS: { [key: string]: { [key: string]: string } } = {
  '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935': {
    baseToken: '0x88800092ff476844f74dc2fc427974bbee2794ae',
    name: 'WALLET Staking Pool'
  },
  '0xb6456b57f03352be48bf101b46c1752a0813491a': {
    baseToken: '0xade00c28244d5ce17d72e40330b1c318cd12b7c3',
    name: 'ADX Staking Pool'
  },
  // this is on polygon for tests
  '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e': {
    baseToken: '0xe9415e904143e42007865e6864f7f632bd054a08',
    name: 'WALLET Staking Pool (Test)'
  }
}
// const WALLET_TOKEN_ADDR = '0x88800092ff476844f74dc2fc427974bbee2794ae'

export const StakingPools = (humanizerInfo: any) => {
  const iface = new ethers.Interface(getKnownAbi(humanizerInfo, 'StakingPool'))
  return {
    [iface.getFunction('enter')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { amount } = iface.parseTransaction(call)!.args
      return [
        getAction('Deposit'),
        getToken(STAKING_POOLS[call.to].baseToken, amount),
        getLabel('to'),
        getAddressVisualization(call.to)
      ]
    },
    [iface.getFunction('leave')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { shares } = iface.parseTransaction(call)!.args

      return [
        getAction('Leave'),
        getLabel('with'),
        getToken(STAKING_POOLS[call.to].baseToken, shares),
        getAddressVisualization(call.to)
      ]
    },
    [iface.getFunction('withdraw')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { shares } = iface.parseTransaction(call)!.args
      return [
        getAction('Withdraw'),
        getToken(STAKING_POOLS[call.to].baseToken, shares),
        getLabel('from'),
        getAddressVisualization(call.to)
      ]
    },

    [iface.getFunction('rageLeave')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { shares } = iface.parseTransaction(call)!.args
      return [
        getAction('Rage leave'),
        getLabel('with'),
        getToken(STAKING_POOLS[call.to].baseToken, shares),
        getAddressVisualization(call.to)
      ]
    }
  }
}
