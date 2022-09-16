import ERC20ABI from 'adex-protocol-eth/abi/ERC20.json'
import { BigNumber, constants, Contract } from 'ethers'
import { Interface } from 'ethers/lib/utils'

import { NetworkId } from '../../constants/networks'
import { Account } from '../../hooks/useAccounts'
import { Token } from '../../hooks/usePortfolio'
import { UseToastsReturnType } from '../../hooks/useToasts'
import { getProvider } from '../provider'

const ERC20Interface = new Interface(ERC20ABI)

const approveToken = async (
  scope: string,
  networkId: NetworkId,
  accountId: Account['id'],
  address: string,
  tokenAddress: Token['address'],
  addRequestTxn: (id: string, txn: { to: string; value: string; data: string }) => any,
  addToast: UseToastsReturnType['addToast'],
  bigNumberHexAmount: BigNumber = constants.MaxUint256
) => {
  try {
    const prefixId = scope.toLowerCase().replace(/' '/g, '_')
    const provider = getProvider(networkId)
    const tokenContract = new Contract(tokenAddress, ERC20Interface, provider)
    const allowance = await tokenContract.allowance(accountId, address)

    if (allowance.lt(bigNumberHexAmount)) {
      addRequestTxn(`${prefixId}_approve_${Date.now()}`, {
        to: tokenAddress,
        value: '0x0',
        data: ERC20Interface.encodeFunctionData('approve', [address, bigNumberHexAmount])
      })
    }
  } catch (e: any) {
    addToast(`${scope} Approve Error: ${e.message || e}`, { error: true })
  }
}

export default approveToken
