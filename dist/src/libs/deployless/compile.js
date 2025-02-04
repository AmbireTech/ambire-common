import fs from 'fs';
import path from 'path';
// solc js doesn't support typescript so we hack it
let _solc = null;
function getSolc() {
    if (!_solc) {
        _solc = require('solc');
    }
    return _solc;
}
// a function that compiles a contract at run time as long
// as that contract and all its includes are in the /contracts folder
//
// contractName - the name of the contract, not the file name
// options
//   - fileName - if the name of the file is different than the name
// of the contract, it should be passed along as we cannot guess it
export function compile(contractName, options = {}) {
    const fileName = options.fileName ? options.fileName : `${contractName}.sol`;
    const contractsFolder = options.contractsFolder ? options.contractsFolder : 'contracts';
    const contractPath = path.resolve(`${__dirname}../../../../`, contractsFolder, fileName);
    const contractSource = fs.readFileSync(contractPath, { encoding: 'utf8' });
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
                runs: 1000
            },
            outputSelection: {
                '*': {
                    '*': ['*']
                }
            }
        }
    };
    function findImports(libPath) {
        let compileFolder = libPath.indexOf('node_modules') === -1
            ? contractsFolder
            : '';
        if (libPath.indexOf('contracts/libs') !== -1) {
            compileFolder = '';
        }
        return {
            contents: fs.readFileSync(path.resolve(`${__dirname}../../../../`, compileFolder, libPath), {
                encoding: 'utf8'
            })
        };
    }
    const output = JSON.parse(getSolc().compile(JSON.stringify(input), { import: findImports }));
    if (output.errors) {
        const error = output.errors.map((err) => `${err.formattedMessage} `);
        throw new Error(error);
    }
    if (!output.contracts[contractName][contractName]) {
        throw new Error(`unable to find contract named ${contractName} in output from file ${contractName}: perhaps the name of the file is different compared to the name of the contract?`);
    }
    return {
        abi: output.contracts[contractName][contractName].abi,
        bin: `0x${output.contracts[contractName][contractName].evm.bytecode.object}`,
        binRuntime: `0x${output.contracts[contractName][contractName].evm.deployedBytecode.object}` // binRuntime
    };
}
//# sourceMappingURL=compile.js.map