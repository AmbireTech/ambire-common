const { ethers, JsonRpcProvider } = require("ethers")
const AmbireAccount = require("../contracts/compiled/AmbireAccount.json");
const AmbireAccountFactory = require("../contracts/compiled/AmbireAccountFactory.json");
require('dotenv').config();

const polygonUrl = 'https://rpc.ankr.com/polygon'
const polygonChainId = 137
const provider = new JsonRpcProvider(polygonUrl)

async function deploy() {
    
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
deploy().catch((error) => {
  console.error(error)
  process.exitCode = 1
});
