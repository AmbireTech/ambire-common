import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { getAction, getLabel, getOnBehalfOf, getToken } from '../../utils'

const AaveLendingPoolV2 = [
  'function FLASHLOAN_PREMIUM_TOTAL() view returns (uint256)',
  'function LENDINGPOOL_REVISION() view returns (uint256)',
  'function MAX_NUMBER_RESERVES() view returns (uint256)',
  'function MAX_STABLE_RATE_BORROW_SIZE_PERCENT() view returns (uint256)',
  'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)',
  'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function finalizeTransfer(address asset, address from, address to, uint256 amount, uint256 balanceFromBefore, uint256 balanceToBefore)',
  'function flashLoan(address receiverAddress, address[] assets, uint256[] amounts, uint256[] modes, address onBehalfOf, bytes params, uint16 referralCode)',
  'function getAddressesProvider() view returns (address)',
  'function getConfiguration(address asset) view returns ((uint256 data))',
  'function getReserveData(address asset) view returns (((uint256 data) configuration, uint128 liquidityIndex, uint128 variableBorrowIndex, uint128 currentLiquidityRate, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint8 id))',
  'function getReserveNormalizedIncome(address asset) view returns (uint256)',
  'function getReserveNormalizedVariableDebt(address asset) view returns (uint256)',
  'function getReservesList() view returns (address[])',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function getUserConfiguration(address user) view returns ((uint256 data))',
  'function initReserve(address asset, address aTokenAddress, address stableDebtAddress, address variableDebtAddress, address interestRateStrategyAddress)',
  'function initialize(address provider)',
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)',
  'function paused() view returns (bool)',
  'function rebalanceStableBorrowRate(address asset, address user)',
  'function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) returns (uint256)',
  'function setConfiguration(address asset, uint256 configuration)',
  'function setPause(bool val)',
  'function setReserveInterestRateStrategyAddress(address asset, address rateStrategyAddress)',
  'function setUserUseReserveAsCollateral(address asset, bool useAsCollateral)',
  'function swapBorrowRateMode(address asset, uint256 rateMode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)'
]

export const aaveLendingPoolV2 = (): { [key: string]: Function } => {
  const iface = new Interface(AaveLendingPoolV2)
  const matcher = {
    [iface.getFunction('deposit')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(asset, amount),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdraw')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(asset, amount),
        getLabel('from Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repay')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount /* rateMode */, , onBehalf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(asset, amount),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrow')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [asset, amount] = iface.parseTransaction(call)?.args || []
      return [getAction('Borrow'), getToken(asset, amount), getLabel('from Aave lending pool')]
    }
  }
  return matcher
}
