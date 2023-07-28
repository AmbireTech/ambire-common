const { ethers } = require('ethers')
const h = require('../src/libs/humanizer/humanizerInfo.json')

const one = h.abis.UniV3Router
const two = h.abis.UniV3Router2
const data = [[], []]
const ifacev3 = new ethers.Interface(one)
const ifacev32 = new ethers.Interface(two)
one.forEach((element) => {
  element.type === 'function' ? data[0].push({ name: element.name, inputs: element.inputs }) : null
})
two.forEach((element) => {
  element.type === 'function' ? data[1].push({ name: element.name, inputs: element.inputs }) : null
})

console.log(data[0].length, data[1].length)
for (let i = 0; i < data[1].length; i++) {
  const first = data[1][i]
  const second = data[0].find((f) => {
    return f.name === data[1][i].name
  })
  console.log(first.name)
  if (second) {
    JSON.stringify(first.inputs) === JSON.stringify(second.inputs) ||
    first.name === 'multicall' || // ready
    first.name === 'sweepToken' ||
    first.name === 'sweepTokenWithFee' ||
    first.name === 'unwrapWETH9' // ready
      ? // first.name === 'unwrapWETH9WithFee'
        console.log('same')
      : //   : console.log(first.inputs, second.inputs)
        console.log(
          first.name,
          ifacev3.getFunction(first.name)?.selector,
          ifacev32.getFunction(second.name)?.selector
        )
  } else {
    console.log('not present')
  }
}
