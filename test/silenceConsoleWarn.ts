/**
 * Runs before every test file. Warnings are expected noise in tests, so they are dropped.
 * A test can still check one with jest.spyOn(console, 'warn').
 */
console.warn = () => {}
