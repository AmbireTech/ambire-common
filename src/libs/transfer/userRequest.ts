import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { Interface, parseUnits } from 'ethers'
import { SignUserRequest } from 'interfaces/userRequest'

import WALLETSupplyControllerABI from '../../../contracts/compiled/WALLETSupplyController.json'
import { TokenResult } from '../../libs/portfolio'
import { getSanitizedAmount } from './amount'

const ERC20 = new Interface(erc20Abi)
const supplyControllerInterface = new Interface(WALLETSupplyControllerABI)

interface BuildUserRequestParams {
  amount: string
  selectedToken: TokenResult
  selectedAccount: string
  recipientAddress: string
}

const supplyControllerAddress = '0xA69B8074CE03A33B13057B1e9D37DCDE0024Aaff'
const WALLET_STAKING_ADDR = '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'

function buildClaimWalletRequest({
  selectedAccount,
  selectedToken,
  claimableRewardsData,
}: { selectedAccount: string, selectedToken: TokenResult, claimableRewardsData: any }): SignUserRequest | null {
  const txn = {
    kind: 'call' as const,
    to: supplyControllerAddress,
    value: '0x0',
    data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
      claimableRewardsData?.totalClaimable,
      claimableRewardsData?.proof,
      0, // penalty bps, at the moment we run with 0; it's a safety feature to hardcode it
      WALLET_STAKING_ADDR, // staking pool addr
      claimableRewardsData?.root,
      claimableRewardsData?.signedRoot
    ])
  }
  return {
    id: new Date().getTime(),
    action: txn,
    meta: {
      isSignAction: true,
      networkId: selectedToken.networkId,
      accountAddr: selectedAccount
    }
  }
}

function buildTransferUserRequest({
  amount,
  selectedToken,
  selectedAccount,
  recipientAddress: _recipientAddress
}: BuildUserRequestParams): SignUserRequest | null {
  if (!selectedToken || !selectedAccount || !_recipientAddress) return null

  // if the request is a top up, the recipient is the relayer
  const recipientAddress = _recipientAddress?.toLowerCase()
  const sanitizedAmount = getSanitizedAmount(amount, selectedToken.decimals)

  const bigNumberHexAmount = `0x${parseUnits(
    sanitizedAmount,
    Number(selectedToken.decimals)
  ).toString(16)}`

  const txn = {
    kind: 'call' as const,
    to: selectedToken.address,
    value: BigInt(0),
    data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
  }

  if (Number(selectedToken.address) === 0) {
    txn.to = recipientAddress
    txn.value = BigInt(bigNumberHexAmount)
    txn.data = '0x'
  }

  return {
    id: new Date().getTime(),
    action: txn,
    meta: {
      isSignAction: true,
      networkId: selectedToken.networkId,
      accountAddr: selectedAccount
    }
  }
}

export { buildTransferUserRequest, buildClaimWalletRequest }
