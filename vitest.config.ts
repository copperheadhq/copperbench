import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Sandbox materialization shells out to git and copperhead's `init`
    // (real subprocesses, no LLM/network); scoring some assertions shells
    // out to kicad-cli. Running multiple test files' beforeAll hooks
    // concurrently (vitest's default) overloads a normal dev machine and
    // produces spurious hook timeouts under load, not real failures — these
    // are integration tests exercising real subprocesses, not pure unit
    // tests suited to aggressive parallelization.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
