/* eslint-disable @typescript-eslint/no-shadow */
import { ethers } from 'ethers'
import { HumanizerFragment, Ir, IrCall } from '../interfaces'
import { getAddress, getAction, getLable, getToken } from '../utils'
import { AccountOp } from '../../accountOp/accountOp'

// @TODO check in network and humanizetv
// const vaultNames = { ethereum: 'Yearn', polygon: 'Tesseract' }
const tokenPrefixes = { ethereum: 'y', polygon: 'tv' }
// add 'y' or 'tv' prefix, eg '10 USDC' will become '10 yUSDC' to signify vault tokens

export const yearnVaultModule = (
  accountOp: AccountOp,
  ir: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Array<Promise<HumanizerFragment | null>>] => {
  const { yearnVaults, tesseractVaults } = accountOp.humanizerMeta || {}
  //   const yearnWETHVaultAddress = '0xa258C4606Ca8206D8aA700cE2143D7db854D168c'
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:YearnVault'])
  const getVaultInfo = ({ to }: IrCall) =>
    yearnVaults.find((x: any) => x.addr === to) || tesseractVaults.find((x: any) => x.addr === to)

  const matcher = {
    [`${iface.getFunction('deposit(uint256,address)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [amount] = iface.parseTransaction(call)!.args
      const vaultInfo = getVaultInfo(call)
      return [
        getAction('Deposit'),
        getToken(vaultInfo.baseToken, amount),
        getLable('to'),
        getAddress(vaultInfo.addr)
      ]
    },
    [`${iface.getFunction('withdraw(uint256,address)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      // @TODO check network (eth/poly) to add proper prefic (from tokenPrefixes y/tv) in nameParsing
      const [amount] = iface.parseTransaction(call)!.args
      const vaultInfo = getVaultInfo(call)
      return [
        getAction('Withdraw'),
        getToken(vaultInfo.baseToken, amount),
        getLable('from'),
        getAddress(vaultInfo.addr)
      ]
    },
    [`${iface.getFunction('withdraw(uint256)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [maxShares] = iface.parseTransaction(call)!.args

      const vaultInfo = getVaultInfo(call)
      return [
        getAction('Withdraw'),
        getToken(vaultInfo.baseToken, maxShares),
        getLable('from'),
        getAddress(vaultInfo.addr)
      ]
    },
    [`${iface.getFunction('approve(address,uint256)')?.selector}`]: (
      accountOp: AccountOp,
      call: IrCall
    ) => {
      const [to, amount] = iface.parseTransaction(call)!.args

      const vaultInfo = getVaultInfo(call)
      return [
        getAction('Approve'),
        getAddress(to),
        getLable('for'),
        getToken(vaultInfo.baseToken, amount)
      ]
    }
  }
  const newCalls: IrCall[] = []
  ir.calls.forEach((_call) => {
    const call = { ..._call, to: ethers.getAddress(_call.to) }
    // @TODO check if call.to is a vault
    if (getVaultInfo(call)) {
      let visualization = []

      if (matcher[call.data.slice(0, 10)]) {
        visualization = matcher[call.data.slice(0, 10)](accountOp, call)
        let prefix = ''
        if (accountOp.networkId === '1') prefix = tokenPrefixes.ethereum
        if (accountOp.networkId === '137') prefix = tokenPrefixes.polygon
        visualization = visualization.map((v) =>
          v.type === 'token'
            ? {
                ...v,
                symbol: `${prefix}${
                  accountOp.humanizerMeta?.[`tokens:${getVaultInfo(call).baseToken}`][0]
                }`
              }
            : v
        )
      } else {
        visualization = [getAction('Unknown action (yearn)'), getLable('to'), getAddress(call.to)]
      }

      newCalls.push({ ...call, fullVisualization: visualization })
    } else {
      newCalls.push(call)
    }
  })

  return [{ ...ir, calls: newCalls }, []]
}
