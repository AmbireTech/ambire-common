require('dotenv').config()

const { ethers, network } = require('hardhat')
const { Interface, keccak256, AbiCoder } = require('ethers')
const AmbireFactory = require('../contracts/compiled/AmbireFactory.json')
const { AMBIRE_ACCOUNT_FACTORY, AMBIRE_PAYMASTER_SIGNER } = require('@/consts/deploy')
const { getSmartAccount } = require('@/libs/account/account')
const { callToTuple } = require('@/libs/accountOp/accountOp')
const { getActivatorCall } = require('@/libs/userOperation/userOperation')

function wrapTypedData(chainId, verifyingAddr, executeHash) {
  const domain = {
    name: 'Ambire',
    version: '1',
    chainId: chainId.toString(),
    verifyingContract: verifyingAddr,
    salt: ethers.toBeHex(0, 32)
  }
  const types = {
    AmbireOperation: [
      { name: 'account', type: 'address' },
      { name: 'hash', type: 'bytes32' }
    ]
  }
  const value = {
    account: verifyingAddr,
    hash: executeHash
  }

  return {
    domain,
    types,
    value
  }
}

async function main() {
  const [deployer, paymasterSigner] = await ethers.getSigners()

  const ambireFactory = new Interface(AmbireFactory.abi)
  const account = await getSmartAccount(
    [
      {
        addr: AMBIRE_PAYMASTER_SIGNER,
        hash: '0x0000000000000000000000000000000000000000000000000000000000000002' // full perm
      }
    ],
    []
  )
  const providerNetwork = await ethers.provider.getNetwork()
  const network = await ethers.provider.getNetwork()
  const chainId = network.chainId
  const abiCoder = new AbiCoder()
  const entryPointAuthTxns = [callToTuple(getActivatorCall(account.addr))]
  const executeHash = keccak256(
    abiCoder.encode(
      ['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'],
      [account.addr, chainId, 0n, entryPointAuthTxns]
    )
  )
  const typedData = wrapTypedData(chainId, account.addr, executeHash)
  const s = await paymasterSigner.signTypedData(typedData.domain, typedData.types, typedData.value)
  const signature = `${s}01`

  const tx = {
    to: AMBIRE_ACCOUNT_FACTORY,
    value: 0n,
    data: ambireFactory.encodeFunctionData('deployAndExecute', [
      account.creation.bytecode,
      account.creation.salt,
      entryPointAuthTxns,
      signature
    ]),
    gasLimit: 2000000n
  }

  // Send the transaction
  const txResponse = await deployer.sendTransaction(tx)

  // Wait for the transaction to be mined
  const txReceipt = await txResponse.wait()

  console.log('Transaction sent!')
  console.log(txReceipt)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
