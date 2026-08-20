import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { STK_WALLET, WALLET_STAKING_ADDR, WALLET_TOKEN } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import {
  getWalletAmountFromXWallet,
  getXWalletConversionText,
  WALLET_STAKING_CHAIN_ID
} from '../../../walletStaking/shareValue'
import { HumanizerCallModule, HumanizerContext, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getBreak, getInfo, getLabel, getToken, isHexCall } from '../../utils'
import { StakingPools } from './stakingPools'
// update return ir to be {...ir,calls:newCalls} instead of {calls:newCalls} everywhere
import { WALLETSupplyControllerMapping } from './WALLETSupplyController'

const stakingAddresses = [
  '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
  '0xb6456b57f03352be48bf101b46c1752a0813491a',
  '0xec3b10ce9cabab5dbf49f946a623e294963fbb4e'
]

const WALLET_SUPPLY_CONTROLLER_MAPPING = WALLETSupplyControllerMapping()
const STAKING_POOLS = StakingPools()

const wrapAllAbi = parseAbi(['function wrapAll()'])
const stkWrapAbi = parseAbi(['function wrap(uint256 shareAmount)'])
const stkUnwrapAbi = parseAbi(['function unwrap(uint256 shareAmount)'])
const stkEnterAbi = parseAbi(['function enter(uint256 amount)'])

export const isStkWalletUnwrapCall = (call: IrCall) =>
  isHexCall(call) &&
  call.to?.toLowerCase() === STK_WALLET.toLowerCase() &&
  call.data.startsWith(toFunctionSelector(stkUnwrapAbi[0]))

export const WALLETModule: HumanizerCallModule = (
  accountOp: AccountOp,
  call: IrCall,
  _,
  context?: HumanizerContext
) => {
  const matcher = {
    supplyController: WALLET_SUPPLY_CONTROLLER_MAPPING,
    stakingPool: STAKING_POOLS,
    stkWallet: {
      [toFunctionSelector(wrapAllAbi[0])]: () => {
        return [
          getAction('Wrap all'),
          getToken(WALLET_STAKING_ADDR, 0n),
          getLabel('to'),
          getToken(STK_WALLET, 0n)
        ]
      },
      [toFunctionSelector(stkWrapAbi[0])]: ({ data }: HexIrCall) => {
        const { args } = decodeFunctionData({ abi: stkWrapAbi, data })
        const [shareAmount] = args

        return [
          getAction('Wrap'),
          getToken(WALLET_STAKING_ADDR, shareAmount),
          getLabel('to'),
          getToken(STK_WALLET, 0n)
        ]
      },
      [toFunctionSelector(stkUnwrapAbi[0])]: ({ data }: HexIrCall) => {
        const { args } = decodeFunctionData({ abi: stkUnwrapAbi, data })
        const [shareAmount] = args
        const visualization = [
          getAction('Unwrap'),
          getToken(STK_WALLET, 0n),
          getLabel('for'),
          getToken(WALLET_STAKING_ADDR, shareAmount)
        ]

        if (
          accountOp.chainId !== WALLET_STAKING_CHAIN_ID ||
          !context?.xWalletShareValue ||
          context.xWalletShareValue <= 0n
        ) {
          return visualization
        }

        const walletAmount = getWalletAmountFromXWallet(shareAmount, context.xWalletShareValue)

        return [
          ...visualization,
          getBreak(),
          getInfo(getXWalletConversionText(shareAmount, walletAmount))
        ]
      },
      [toFunctionSelector(stkEnterAbi[0])]: ({ data }: HexIrCall) => {
        const { args } = decodeFunctionData({ abi: stkEnterAbi, data })
        const [amount] = args

        return [
          getAction('Stake and wrap'),
          getToken(WALLET_TOKEN, amount),
          getLabel('for'),
          getToken(STK_WALLET, 0n)
        ]
      }
    }
  }
  if (!isHexCall(call)) return call
  const selector = call.data.slice(0, 10)
  if (call.to && stakingAddresses.includes(call.to.toLowerCase()) && !call.fullVisualization) {
    if (matcher.stakingPool[selector]) {
      return {
        ...call,
        fullVisualization: matcher.stakingPool[selector](call)
      }
    }
  }
  if (matcher.supplyController[selector]) {
    return {
      ...call,
      fullVisualization: matcher.supplyController[selector](call)
    }
  }
  if (
    call.to &&
    call.to.toLowerCase() === STK_WALLET.toLowerCase() &&
    matcher.stkWallet[selector]
  ) {
    return {
      ...call,
      fullVisualization: matcher.stkWallet[selector](call)
    }
  }
  return call
}
