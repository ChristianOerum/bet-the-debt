import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The store uses the SQLite built into Node, which still needs a flag to switch on.
    execArgv: ['--experimental-sqlite', '--disable-warning=ExperimentalWarning'],
  },
});
