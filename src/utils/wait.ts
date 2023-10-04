/* eslint-disable no-promise-executor-return */
function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default wait
