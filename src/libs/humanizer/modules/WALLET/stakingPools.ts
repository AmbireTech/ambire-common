import { ethers } from 'ethers'
import { getAction, getLabel, getToken, getAddress } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'

const STAKING_POOLS: { [key: string]: { [key: string]: string } } = {
  '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935': {
    baseToken: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
    name: 'WALLET Staking Pool'
  },
  '0xB6456b57f03352bE48Bf101B46c1752a0813491a': {
    baseToken: '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3',
    name: 'ADX Staking Pool'
  },
  // this is on polygon for tests
  '0xEc3b10ce9cabAb5dbF49f946A623E294963fBB4E': {
    baseToken: '0xE9415E904143e42007865E6864f7F632Bd054A08',
    name: 'WALLET Staking Pool (Test)'
  }
}
// const WALLET_TOKEN_ADDR = '0x88800092ff476844f74dc2fc427974bbee2794ae'

export const StakingPools = (humanizerInfo: any) => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:StakingPool'])
  return {
    [iface.getFunction('enter')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { amount } = iface.parseTransaction(call)!.args
      return [
        getAction('Deposit'),
        getToken(STAKING_POOLS[call.to].baseToken, amount),
        getLabel('to'),
        getAddress(call.to)
      ]
    },
    [iface.getFunction('leave')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { shares } = iface.parseTransaction(call)!.args

      return [
        getAction('Leave'),
        getLabel('with'),
        getToken(STAKING_POOLS[call.to].baseToken, shares),
        getAddress(call.to)
      ]
    },
    [iface.getFunction('withdraw')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { shares } = iface.parseTransaction(call)!.args
      return [
        getAction('Withdraw'),
        getToken(STAKING_POOLS[call.to].baseToken, shares),
        getLabel('from'),
        getAddress(call.to)
      ]
    },

    [iface.getFunction('rageLeave')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const { shares } = iface.parseTransaction(call)!.args
      return [
        getAction('Rage leave'),
        getLabel('with'),
        getToken(STAKING_POOLS[call.to].baseToken, shares),
        getAddress(call.to)
      ]
    }
  }
}
