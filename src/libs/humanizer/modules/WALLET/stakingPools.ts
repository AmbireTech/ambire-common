import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { HumanizerVisualization } from '../../interfaces'
import { HexIrCall, getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

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

const enterAbi = parseAbi(['function enter(uint256 amount)'])
const leaveAbi = parseAbi(['function leave(uint256 shares, bool skipMint)'])
const withdrawAbi = parseAbi([
  'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)'
])
const rageLeaveAbi = parseAbi(['function rageLeave(uint256 shares, bool skipMint)'])

export const StakingPools = (): { [key: string]: (c: HexIrCall) => HumanizerVisualization[] } => {
  return {
    [toFunctionSelector(enterAbi[0])]: (call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in staking humanizer when !call.to')
      const baseToken = STAKING_POOLS[call.to.toLowerCase()]?.baseToken
      if (!baseToken) throw Error('Humanizer: unknown staking pool')
      const { args } = decodeFunctionData({ abi: enterAbi, data: call.data })
      const [amount] = args
      return [
        getAction('Deposit'),
        getToken(baseToken, amount),
        getLabel('to'),
        getAddressVisualization(call.to)
      ]
    },
    [toFunctionSelector(leaveAbi[0])]: (call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in staking humanizer when !call.to')
      const { args } = decodeFunctionData({ abi: leaveAbi, data: call.data })
      const [shares] = args

      return [getAction('Leave'), getLabel('with'), getToken(call.to, shares)]
    },
    [toFunctionSelector(withdrawAbi[0])]: (call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in staking humanizer when !call.to')
      const { args } = decodeFunctionData({ abi: withdrawAbi, data: call.data })
      const [shares] = args
      return [getAction('Withdraw'), getToken(call.to, shares)]
    },

    [toFunctionSelector(rageLeaveAbi[0])]: (call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in staking humanizer when !call.to')
      const { args } = decodeFunctionData({ abi: rageLeaveAbi, data: call.data })
      const [shares] = args
      return [getAction('Rage leave'), getLabel('with'), getToken(call.to, shares)]
    }
  }
}
