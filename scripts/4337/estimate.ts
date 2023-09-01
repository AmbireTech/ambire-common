import fetch from 'node-fetch'

const options = {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify({
    id: 1,
    jsonrpc: '2.0',
    method: 'eth_estimateUserOperationGas',
    params: [
      {
        sender: '0xD1cE5E6AE56693D2D3D52b2EBDf969C1D7901971',
        nonce: '0x00',
        initCode: '0x',
        callData:
          '0x6171d1c90000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000c2e6dfcc2c6722866ad65f211d5757e1d2879337000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042814242b7fbe3f21e272276abfe4b6ca7a2bdfd19e9f47736bc3ae4a8b528277c710928fb7ee2f70911c71fb17bb259a385d3a426e5b3cb0726addcd34d1353021c01000000000000000000000000000000000000000000000000000000000000',
        callGasLimit: '0x186a0',
        verificationGasLimit: '0x7a120',
        preVerificationGas: '0xc350',
        maxFeePerGas: '0x2e90edd000',
        maxPriorityFeePerGas: '0x2e90edd000',
        signature:
          '0x814242b7fbe3f21e272276abfe4b6ca7a2bdfd19e9f47736bc3ae4a8b528277c710928fb7ee2f70911c71fb17bb259a385d3a426e5b3cb0726addcd34d1353021c01',
        // '0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c',
        paymasterAndData:
          '0x4Fd9098af9ddcB41DA48A1d78F91F1398965addcfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c'
      },
      '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'

    ]
  })
}

fetch('https://polygon-mainnet.g.alchemy.com/v2/YC6hEku0Ah6hfnkLjQjKLmMlZFrZsxEp', options)
  .then((response) => response.json())
  .then((response) => console.log(response))
  .catch((err) => console.error(err))
