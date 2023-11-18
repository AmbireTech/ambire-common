/* eslint-disable @typescript-eslint/no-shadow */
import { ethers } from 'ethers'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getAddress, getAction, getLabel, getToken, getUnknownVisualization } from '../utils'
import { AccountOp } from '../../accountOp/accountOp'

// const vaultNames = { ethereum: 'Yearn', polygon: 'Tesseract' }
const tokenPrefixes = { ethereum: 'y' }
// add 'y' or 'tv' prefix, eg '10 USDC' will become '10 yUSDC' to signify vault tokens

export const yearnVaultModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const { yearnVaults } = accountOp.humanizerMeta || {}
  //   const yearnWETHVaultAddress = '0xa258C4606Ca8206D8aA700cE2143D7db854D168c'
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:YearnVault'])
  const getVaultInfo = (to: string) => yearnVaults.find((x: any) => x.addr === to)

  const matcher = {
    [iface.getFunction('deposit(uint256,address)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amount] = iface.parseTransaction(call)!.args
      const vaultInfo = getVaultInfo(call.to)
      return [
        getAction('Deposit'),
        getToken(vaultInfo.baseToken, amount),
        getLabel('to'),
        getAddress(vaultInfo.addr)
      ]
    },
    [iface.getFunction('withdraw(uint256,address)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amount] = iface.parseTransaction(call)!.args
      const vaultInfo = getVaultInfo(call.to)
      return [
        getAction('Withdraw'),
        getToken(vaultInfo.baseToken, amount),
        getLabel('from'),
        getAddress(vaultInfo.addr)
      ]
    },
    [iface.getFunction('withdraw(uint256)')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [maxShares] = iface.parseTransaction(call)!.args

      const vaultInfo = getVaultInfo(call.to)
      return [
        getAction('Withdraw'),
        getToken(vaultInfo.baseToken, maxShares),
        getLabel('from'),
        getAddress(vaultInfo.addr)
      ]
    },
    [iface.getFunction('approve(address,uint256)')?.selector!]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [to, amount] = iface.parseTransaction(call)!.args

      const vaultInfo = getVaultInfo(call.to)
      return [
        getAction('Approve'),
        getAddress(to),
        getLabel('for'),
        getToken(vaultInfo.baseToken, amount)
      ]
    }
  }
  const newCalls: IrCall[] = []
  irCalls.forEach((_call) => {
    const call = { ..._call, to: ethers.getAddress(_call.to) }
    // checks if call.to is a vault
    if (getVaultInfo(call.to)) {
      let visualization = []

      if (matcher[call.data.slice(0, 10)]) {
        visualization = matcher[call.data.slice(0, 10)](accountOp, call)
        let prefix = ''
        if (accountOp.networkId === 'ethereum') prefix = tokenPrefixes.ethereum
        visualization = visualization.map((v) =>
          v.type === 'token'
            ? {
                ...v,
                symbol: `${prefix}${
                  accountOp.humanizerMeta?.[`tokens:${getVaultInfo(call.to).baseToken}`][0]
                }`
              }
            : v
        )
      } else {
        visualization = getUnknownVisualization('yearn', call)
      }

      newCalls.push({ ...call, fullVisualization: visualization })
    } else {
      newCalls.push(call)
    }
  })

  return [newCalls, []]
}
