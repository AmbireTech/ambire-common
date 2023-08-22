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
): [Ir, Array<Promise<HumanizerFragment>>] => {
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
      // @TODO check network (eth/poly) to add proper prefic (from tokenPrefixes y/tv) in namingHUmanizer
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
  let newCalls: IrCall[] = []
  ir.calls.forEach((_call) => {
    const call = { ..._call, to: ethers.getAddress(_call.to) }
    // @TODO check if call.to is a vault
    if (getVaultInfo(call)) {
      if (matcher[call.data.slice(0, 10)]) {
        newCalls.push({
          ...call,
          fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call)
        })
      } else {
        newCalls.push({
          ...call,
          fullVisualization: [getAction('Unknown yearn action')]
        })
      }
    } else {
      newCalls.push(call)
    }

    // naming
    newCalls = newCalls.map((call) => ({
      ...call,
      fullVisualization: call.fullVisualization?.map((v: any) => {
        if (v.type === 'token') {
          let prefix = ''
          if (accountOp.networkId === '1') prefix = tokenPrefixes.ethereum
          if (accountOp.networkId === '137') prefix = tokenPrefixes.polygon
          const name = `${prefix}${accountOp.humanizerMeta?.[`tokens:${v.address}`][0]}`
          return { ...v, name }
        }
        return v
      })
    }))
  })

  return [{ ...ir, calls: newCalls }, []]
}
