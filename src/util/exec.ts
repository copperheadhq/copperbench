import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a subprocess to completion, rejecting with stdout/stderr attached on a
 * non-zero exit. Used for git plumbing and for driving copperhead's CLI as a
 * subprocess (see runner/copperhead-install.ts) — never for anything on the
 * scorer's path, which must stay reachable with no network (STANDARD.md
 * section 4, design D2/D3).
 */
export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} ${args.join(' ')} failed: ${err.message}\n${stderr}`));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
