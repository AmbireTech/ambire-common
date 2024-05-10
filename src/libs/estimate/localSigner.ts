// TODO: this file should be deleted

/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
import { AbiCoder, keccak256, Wallet } from 'ethers'

/* eslint-disable max-classes-per-file */
import { Account } from '../../interfaces/account'
import { Key, KeystoreSigner } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { callToTuple } from '../accountOp/accountOp'
import { getTypedData, wrapStandard } from '../signMessage/signMessage'
import { getActivatorCall } from '../userOperation/userOperation'

class LocalSigner implements KeystoreSigner {
  key: Key

  constructor(_key: Key) {
    this.key = _key
  }

  async signRawTransaction() {
    return '0xd994364b5484bcc5ad9261399d7438fa8e59c1b9478bc02ac8f1fc43be523cc634bd165330c7e33b1e2898fed19e01087b9fe787557efb3f845adf2fa288069f1b'
  }

  async signTypedData() {
    return '0xd994364b5484bcc5ad9261399d7438fa8e59c1b9478bc02ac8f1fc43be523cc634bd165330c7e33b1e2898fed19e01087b9fe787557efb3f845adf2fa288069f1b'
  }

  async signMessage() {
    return '0xd994364b5484bcc5ad9261399d7438fa8e59c1b9478bc02ac8f1fc43be523cc634bd165330c7e33b1e2898fed19e01087b9fe787557efb3f845adf2fa288069f1b'
  }
}

export const localSigner = new LocalSigner({
  addr: '0x52C37FD54BD02E9240e8558e28b11e0Dc22d8e85',
  type: 'internal',
  dedicatedToOneSA: true,
  meta: null,
  isExternallyStored: false
})

export async function getDeploySignature(smartAcc: Account, network: NetworkDescriptor) {
  // CODE FOR getting a valid deploy signature if you have the PK
  const nonce = 0
  const call = getActivatorCall(smartAcc.addr)
  const tupleCall = callToTuple(call)
  const txns = [tupleCall]
  const abiCoder = new AbiCoder()
  const executeHash = keccak256(
    abiCoder.encode(
      ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
      [smartAcc.addr, network.chainId, nonce, txns]
    )
  )
  const typedData = getTypedData(network.chainId, smartAcc.addr, executeHash)
  const typesWithoutEIP712Domain = { ...typedData.types }
  if (typesWithoutEIP712Domain.EIP712Domain) {
    // eslint-disable-next-line no-param-reassign
    delete typesWithoutEIP712Domain.EIP712Domain
  }
  const wallet = new Wallet(process.env.METAMASK_PK!)
  const s = wrapStandard(
    await wallet.signTypedData(typedData.domain, typesWithoutEIP712Domain, typedData.message)
  )
  return s
}
