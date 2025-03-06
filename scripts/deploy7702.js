require('dotenv').config()
// eslint-disable-next-line import/no-extraneous-dependencies
const { ethers } = require('hardhat')
const { Interface } = require('ethers')
const ambireAccount7702 = require('../contracts/compiled/AmbireAccount7702.json')

async function main() {
  const [deployer] = await ethers.getSigners()

  const bytecode = ambireAccount7702.bin
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

  const tx = {
    to: '0xce0042B868300000d44A59004Da54A005ffdcf9f', // the singleton
    value: 0n,
    data: singletonInterface.encodeFunctionData('deploy', [bytecode, salt]),
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
