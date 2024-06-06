/**
 * Request helper module that spies on HTTP and HTTPS requests and returns all intercepted requests.
 * We could achieve this with jest.spy, but this implementation involves less boilerplate.
 * Please use it only for testing purposes and always invoke `stopMonitoring` after your test finishes.
 *
 * Example use-case: When fetching the portfolio for several different accounts,
 * all the requests for fetching hints and prices should be batched into single requests.
 * With this module, it's very easy to intercept and later validate the requests.
 *
 * Gotcha #1: You may wonder why we didn't use `fetch` for spying.
 * It's because we can't intercept JSON-RPC requests with `fetch`.
 * Gotcha #2: This kind of custom mocking, as implemented here, works only when we import the `http` and `https` libraries with `require`.
 */
const http = require('http')
const https = require('https')

// Store the original request methods
const originalHttpRequest = http.request
const originalHttpsRequest = https.request

// Function to start monitoring requests.
// It returns a mutable `interceptedRequests` variable that holds all the intercepted requests.
function monitor(): any[] {
  // Variable to hold intercepted requests
  const interceptedRequests: any[] = []

  // Intercept HTTP requests
  // @ts-ignore
  // eslint-disable-next-line no-import-assign
  http.request = function (...args) {
    // @ts-ignore
    const request = originalHttpRequest.apply(this, args)
    interceptedRequests.push({ method: 'HTTP', url: args[0] })
    return request
  }

  // Intercept HTTPS requests
  // @ts-ignore
  // eslint-disable-next-line no-import-assign
  https.request = function (...args) {
    // @ts-ignore
    const request = originalHttpsRequest.apply(this, args)
    interceptedRequests.push({ method: 'HTTPS', url: args[0] })
    return request
  }

  return interceptedRequests
}

// Function to stop monitoring requests and restore original methods.
// Always invoke `stopMonitoring` after your test finishes.
function stopMonitoring() {
  // @ts-ignore
  // eslint-disable-next-line no-import-assign
  http.request = originalHttpRequest
  // @ts-ignore
  // eslint-disable-next-line no-import-assign
  https.request = originalHttpsRequest
}

export { monitor, stopMonitoring }
