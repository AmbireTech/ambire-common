const solc = require('solc')
const fs = require('fs')
const path = require('path')

// a function that compiles a contract at run time as long
// as that contract and all its includes are in the /contracts folder
// 
// contractName - the name of the contract, not the file name
// options
//   - fileName - if the name of the file is different than the name
// of the contract, it should be passed along as we cannot guess it
function compileFromContracts(contractName, options = {}) {
  const fileName = 'fileName' in options ? options.fileName : contractName + '.sol'

  const contractPath = path.resolve(__dirname + '../../../../', 'contracts', fileName)
  const contractSource = fs.readFileSync(contractPath, 'UTF-8')

  const input = {
    language: 'Solidity',
    sources: {
      [contractName]: {
          content: contractSource
      }
    },
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 1000,
      },
      outputSelection: {
        '*': {
          '*': ['*']
        }
      }
    }
  }
  
  function findImports(libPath) {
    return {
      contents: fs.readFileSync(path.resolve(__dirname + '../../../../', 'contracts', libPath), 'UTF-8')
    }
  }
  
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
  )

  return {
    abi: output.contracts[contractName][contractName].abi,
    bytecode: output.contracts[contractName][contractName].evm.bytecode, // bin
    deployBytecode: output.contracts[contractName][contractName].evm.deployBytecode, // binRuntime
  }
}

module.exports = {
  compileFromContracts
}