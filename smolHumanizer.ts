import { Interface, toBigInt, hexlify, getAddress } from 'ethers'
import { AbiCoder } from 'ethers'
import fetch from 'node-fetch'
import { readFile, exists } from 'fs'
import { promisify } from 'util'
const _readFile = promisify(readFile)
const _exists = promisify(exists)


async function fetchJson (url: string, body: object, args: object = {}) {
	const headers = { 'Content-Type': 'application/json' }
	const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers, ...args })
	return res.json()
}

async function fetchRpc(url: string, method: string, params: any[] = []) {
	// @TODO: fix any?
	const response: any = await fetchJson(url, { method, params, id: 1, jsonrpc: '2.0' })
	// @TODO is this the right way to handle errors; this should be ok?
	if (response.error) throw response.error
	return response.result
}

// @TODO dynamic URL
const url = 'https://invictus.ambire.com/ethereum'
// 'https://mantle-rpc.publicnode.com' 
async function scrapeSignatures () {
	const mostFrequent = new Map()
	const latestBlock = toBigInt(await fetchRpc(url, 'eth_blockNumber'))
	for (let i = latestBlock - 1000n; i <= latestBlock; i++) {
		const block = await fetchRpc(url,'eth_getBlockByNumber', ['0x'+i.toString(16), true])
		for (const txn of block.transactions) { 
			if (txn.input.length >= 10) {
				const sig = txn.input.slice(2, 10)
				// to debug uni
				// if (sig === '12aa3caf') console.log(txn)
				mostFrequent.set(sig, (mostFrequent.get(sig) ?? 0) + 1)
			}
		}
	}
	const sorted = [...mostFrequent.entries()].sort((a,b) => b[1] - a[1])
	const signatures = await Promise.all(sorted.slice(0, 2500).map(async ([sigHash, hits]) => {
		const path = `/home/ivo/storage/repos/4bytes/signatures/${sigHash}`
		const exists = await _exists(path)
		const sig = exists ? (await _readFile(path)).toString() : null
		return sig && [sig, sigHash, hits]
	}))
  const signaturesFiltered = signatures.filter(x => x)

	console.log(JSON.stringify(signaturesFiltered))
}

// scrapeSignatures()
// 	.catch((e: any) => console.error(e))

// @TODO separate output actions for approve and revoke, so we need a special parser for approvals


// @TODO: import from common
// @TODO call the entire module parser
type NetworkId = string

interface TokenInParsedAction {
	// nothing other than an address and network, retrieving meta is the responsibility of the token component + service
	address: string,
	amount: bigint,
	// @TODO should this be optional?
	networkId?: NetworkId,
	role?: string,
}

interface InteracteeInParsedAction {
	address: string,
	role?: string
}

// Designed to be used together with Call or Message, however for each Call/Message there could be an array of ParsedAction
interface ParsedAction {
	actionName: string,
	interactedWith: InteracteeInParsedAction[],
	tokens: TokenInParsedAction[]
}


// @TODO 
//  - WETH
//  - should we require a sweep?
//  - parse transfer
//  - group
//  - unknwon actions
function parseUniUniversal(txn: any) {

	const iface = new Interface(['function execute(bytes,bytes[],uint256)'])
	const parsed = iface.parseTransaction(txn)

	// What are the special addrs, 0x000...002 ?
	// from uni code at https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Constants.sol (commmit 1cde151b29f101cb06c0db4a2afededa864307b3)
	/// @dev Used as a flag for identifying the transfer of ETH instead of a token
	// address internal constant ETH = address(0);
	/// @dev Used as a flag for identifying that msg.sender should be used, saves gas by sending more 0 bytes
	// address internal constant MSG_SENDER = address(1);
	/// @dev Used as a flag for identifying address(this) should be used, saves gas by sending more 0 bytes
	// address internal constant ADDRESS_THIS = address(2);
	// @TODO: if not parsed
	if (parsed) {
		const abiCoder = new AbiCoder()
		const commandArgs = parsed.args[1]
		const commandsRaw = Buffer.from(parsed.args[0].slice(2), 'hex')
		// @TODO: ugly hack for the path to get in/out: .slice(0, 42), slice(-40)
		// @TODO post-processing: WETH, merging swaps
		const commands = [...commandsRaw]
			// first bit is flag whether to allow the command to revert
			.map(cmdRaw => cmdRaw & 0b01111111)
		const sweeps = commands.map((cmd, idx) => {
			if (cmd === 4) {
				const [token, recipient, minAmount] = abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx])
				return { token, recipient, minAmount }
			}
			return null
		})
		const mapped = commands.map((cmd, idx, allCmds): ParsedAction[] => {
			if (cmd === 0 || cmd === 1 || cmd === 8 || cmd === 9) {
				const isExactIn = cmd === 0 || cmd === 8
				const isV2 = cmd === 8 || cmd === 9
				const pathType =  isV2 ? 'address[0]' : 'bytes'
				// last arg is whether tokens are in the router, we don't care much about this
				// @TODO we need to care about this if we do WETH?
				const [recipient, amount1, amount2, path, /*tokensInRouter*/] =  abiCoder.decode(['address', 'uint256', 'uint256', pathType, 'bool'], commandArgs[idx])
				const tokenIn = getAddress(isV2 ? path[0] : path.slice(0, 42))
				const tokenOut = getAddress(isV2 ? path[path.length - 1] : '0x' + path.slice(-40))
				// how to handle the case case of a different recipient:
				// find the `sweep`, find the recipient to implement different recipient
				// sweep not found -> unknown interaction; sweep found to 0x01 -> nothing, sweep found but not to 0x01 -> add a transfer action

				// @TODO document that we do not need to flag sweeps as used, we just need to find the sweep that matches our command
				// @TODO consider comparing the amount too
				const sweep = sweeps.find(x => x && x.token === tokenOut)
				if (!sweep) return []
				// @TODO: handle WETH; if input is WETH, try to find a wrap and change it to ETH, but also make sure txn.value is equal
				// @TODO handle WETH output; if output is WETH, try to find an unwrap AFTER and if so change it to ETH
				return [cmd === 0
					? { actionName: sweep ? 'swapExactIn' : 'swapUnknown', interactedWith: [], tokens: [
							{ address: tokenIn, amount: amount1, role: 'in' },
							{ address: tokenOut, amount: amount2, role: 'outMin' }
						] } as ParsedAction
					: { actionName: sweep ? 'swapExactOut' : 'swapUnknown', interactedWith: [], tokens: [
						{ address: tokenIn, amount: amount2, role: 'inMax' },
						{ address: tokenOut, amount: amount1, role: 'out' }
					] } as ParsedAction].concat(
						sweep && sweep.recipient !== '0x0000000000000000000000000000000000000001' && sweep.recipient !== txn.from
							? [{
								actionName: 'send',
								interactedWith: [{ address: sweep.recipient }],
								tokens: [{ address: tokenOut, amount: sweep.minAmount, role: 'send' }]
							} as ParsedAction]
							: []
					)
			}
			/*
			if (cmd === 1) console.log('v3 swap exact out', abiCoder.decode(['address', 'uint256', 'uint256', 'bytes', 'bool'], commandArgs[idx]))
			if (cmd === 2) console.log('permit2 transferFrom', commandArgs[idx])
			if (cmd === 3) console.log('permit2 transfer batch', commandArgs[idx])
			if (cmd === 4) console.log('sweep', abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx]))
			if (cmd === 5) console.log('transfer', commandArgs[idx])
			if (cmd === 6) console.log('pay portion', abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx]))
			if (cmd === 10) console.log('permit2 permit', commandArgs[idx])
			if (cmd === 11) console.log('wrap eth', abiCoder.decode(['address', 'uint256'], commandArgs[idx]))
			if (cmd === 12) console.log('unswap eth', abiCoder.decode(['address', 'uint256'], commandArgs[idx]))
			*/

			return []

			// 13 is PERMIT2_TRANSFER_FROM_BATCH
		}).flat().filter(x => x)
		console.log(mapped)
		return mapped
	} else {
		return [{
			actionName: 'unknownSwap', interactedWith: [], tokens: []
		}]
	}
}

function parse1Inch() {
	// @TODO nested structures are unsupported
	const iface = new Interface(['function swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)'])

	const txn = {
		to: '0x1111111254eeb25477b68fb85ed929f73a960582',
		data: '0x12aa3caf000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd09000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000d55210bb6898c021a19de1f58d27b71f095921ee000000000000000000000000e37e799d5077682fa0a244d46e5649f71457bd090000000000000000000000003978b91854b75a5c19203ada5bdc873362355dfa000000000000000000000000000000000000000000000000000c342a7d4a99f600000000000000000000000000000000000000000038709bb571b85783d0fa080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011b0000000000000000000000000000000000000000fd00006e00005400004e802026678dcd0000000000000000000000000000000000000000382ffce2287252f930e1c8dc9328dac5bf282ba100000000000000000000000000000000000000000000000000001f3ddd69b4bd00206b4be0b94041c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2d0e30db00c20c02aaa39b223fe8d0a0e5c4f27ead9083c756cc25bb8f1ce603577a4d17cc9d72f6a4c38f3b0b74c6ae40711b8002dc6c05bb8f1ce603577a4d17cc9d72f6a4c38f3b0b74c1111111254eeb25477b68fb85ed929f73a96058200000000000000000000000000000000000000000038709bb571b85783d0fa08c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000009a635db5',
		value: '0xc342a7d4a99f6',
	}
	const parsed = iface.parseTransaction(txn)
	if (parsed) {
		// see https://etherscan.io/address/0x1111111254eeb25477b68fb85ed929f73a960582#writeContract
		// https://docs.1inch.io/docs/aggregation-protocol/smart-contract/GenericRouter
		// @TODO what is srcReceiver, dstReceiver; ANSWER: srcReceiver must be the recipient of the source token; usually the 1inch exchange
		// [executor, swapDescriptor, permit, data]
		// swapDescriptor: srcToken, dstToken, srcReceiver, dstReceiver, amount, minReturnAmount, flags
		// flags are only _PARTIAL_FILL = 1 << 0; _REQUIRES_EXTRA_ETH = 1 << 1; (https://etherscan.io/address/0x1111111254eeb25477b68fb85ed929f73a960582#code)
		const [ tokenIn, tokenOut,  ] = parsed.args[1]

		console.log(parsed.args)
	}

}

parseUniUniversal({
	  data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000066229ac300000000000000000000000000000000000000000000000000000000000000040b000604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000001906999cbae477f0296c00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002bc02aaa39b223fe8d0a0e5c4f27ead9083c756cc200271088800092ff476844f74dc2fc427974bbee2794ae000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000088800092ff476844f74dc2fc427974bbee2794ae00000000000000000000000037a8f295612602f2774d331e562be9e61b83a3270000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000006000000000000000000000000088800092ff476844f74dc2fc427974bbee2794ae0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000001906999cbae477f0296c',
	  value: 1000000000000000000n,
	  // from: ''
	})
// parse1Inch()
