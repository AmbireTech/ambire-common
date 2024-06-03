import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

const StakingPool = [
  'function ADXToken() view returns (address)',
  'function ADXUSDOracle() view returns (address)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function PERMIT_TYPEHASH() view returns (bytes32)',
  'function allowance(address owner, address spender) view returns (uint256 remaining)',
  'function approve(address spender, uint256 amount) returns (bool success)',
  'function balanceOf(address owner) view returns (uint256 balance)',
  'function claim(address tokenOut, address to, uint256 amount)',
  'function commitments(bytes32) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function enter(uint256 amount)',
  'function enterTo(address recipient, uint256 amount)',
  'function governance() view returns (address)',
  'function guardian() view returns (address)',
  'function leave(uint256 shares, bool skipMint)',
  'function limitLastReset() view returns (uint256)',
  'function limitRemaining() view returns (uint256)',
  'function lockedShares(address) view returns (uint256)',
  'function maxDailyPenaltiesPromilles() view returns (uint256)',
  'function name() view returns (string)',
  'function nonces(address) view returns (uint256)',
  'function penalize(uint256 adxAmount)',
  'function permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function rageLeave(uint256 shares, bool skipMint)',
  'function rageReceivedPromilles() view returns (uint256)',
  'function setDailyPenaltyMax(uint256 max)',
  'function setGovernance(address addr)',
  'function setGuardian(address newGuardian)',
  'function setRageReceived(uint256 rageReceived)',
  'function setTimeToUnbond(uint256 time)',
  'function setWhitelistedClaimToken(address token, bool whitelisted)',
  'function shareValue() view returns (uint256)',
  'function symbol() view returns (string)',
  'function timeToUnbond() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool success)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool success)',
  'function unbondingCommitmentWorth(address owner, uint256 shares, uint256 unlocksAt) view returns (uint256)',
  'function uniswap() view returns (address)',
  'function validator() view returns (address)',
  'function whitelistedClaimTokens(address) view returns (bool)',
  'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)'
]
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

export const StakingPools = () => {
  const iface = new Interface(StakingPool)
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
