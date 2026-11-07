require('dotenv').config()

const { ethers } = require('hardhat')
const {
  AbiCoder,
  Interface,
  ZeroHash,
  concat,
  getAddress,
  getCreate2Address,
  keccak256
} = require('ethers')
const ambirePaymaster = require('../contracts/compiled/AmbirePaymaster.json')
const { AMBIRE_PAYMASTER_SIGNER, SINGLETON } = require('@/consts/deploy')

/**
 * Deploys AmbirePaymaster through the singleton so it gets the same address on every chain.
 * The relayer that signs paymaster data (AMBIRE_PAYMASTER_SIGNER) is a constructor argument,
 * so it's part of the address too.
 *
 * If the contract changed, first run: npm run compile:contracts -- AmbirePaymaster
 * Usage: npx hardhat run scripts/deployPaymaster.js --network <network>
 */
async function main() {
  const [deployer] = await ethers.getSigners()

  const salt = ZeroHash
  const initCode = concat([
    ambirePaymaster.bin,
    AbiCoder.defaultAbiCoder().encode(['address'], [AMBIRE_PAYMASTER_SIGNER])
  ])
  const paymasterAddr = getCreate2Address(SINGLETON, salt, keccak256(initCode))
  console.log('Paymaster address:', paymasterAddr)

  if ((await ethers.provider.getCode(paymasterAddr)) !== '0x') {
    console.log('Already deployed on this network, nothing to do')
    return
  }

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
    to: SINGLETON,
    value: 0n,
    data: singletonInterface.encodeFunctionData('deploy', [initCode, salt]),
    gasLimit: 3500000n
  }

  // Send the transaction
  const txResponse = await deployer.sendTransaction(tx)

  // Wait for the transaction to be mined
  const txReceipt = await txResponse.wait()
  console.log('Transaction mined:', txReceipt.hash)

  // the singleton doesn't revert when the deploy fails (e.g. out of gas), it returns address(0).
  // So confirm the paymaster is actually there and signed by the right relayer
  const paymaster = new ethers.Contract(paymasterAddr, ambirePaymaster.abi, ethers.provider)
  if ((await ethers.provider.getCode(paymasterAddr)) === '0x') {
    throw new Error(`Deploy failed: no code at ${paymasterAddr}`)
  }
  const relayer = await paymaster.relayer()
  if (getAddress(relayer) !== getAddress(AMBIRE_PAYMASTER_SIGNER)) {
    throw new Error(
      `Deployed paymaster has relayer ${relayer}, expected ${AMBIRE_PAYMASTER_SIGNER}`
    )
  }

  console.log(`AmbirePaymaster deployed at ${paymasterAddr} with relayer ${relayer}`)
  console.log('Remember to fund its EntryPoint deposit before pointing the relayer to it')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
