require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')
const { Interface, AbiCoder, concat } = require('ethers')
const ambireAccountOmni = require('../contracts/compiled/AmbireAccountOmni.json')
const { ENTRYPOINT_0_9_0, ENTRYPOINT_0_9_0_OLD } = require('../src/consts/deploy')

async function main() {
  const [deployer] = await ethers.getSigners()

  const bytecode = ambireAccountOmni.bin
  const salt = '0x0000000000000000000000000000000000000000000000000000000000000000'
  const singletonABI = [
    {
      inputs: [
        { internalType: 'bytes', name: '_initCode', type: 'bytes' },
        { internalType: 'bytes32', name: '_salt', type: 'bytes32' }
      ],
      name: 'deploy',
      outputs: [{ internalType: 'address payable', name: 'createdContract', type: 'address' }],
      stateMutability: 'nonpayable',
      type: 'function'
    }
  ]
  const singletonInterface = new Interface(singletonABI)
  const encoder = new AbiCoder()
  const encodedArgs = encoder.encode(
    ['address', 'address'],
    [ENTRYPOINT_0_9_0, ENTRYPOINT_0_9_0_OLD]
  )
  const deploymentBytecode = concat([bytecode, encodedArgs])
  const tx = {
    to: '0xce0042B868300000d44A59004Da54A005ffdcf9f', // the singleton
    value: 0n,
    data: singletonInterface.encodeFunctionData('deploy', [deploymentBytecode, salt]),
    gasLimit: 3500000n
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
