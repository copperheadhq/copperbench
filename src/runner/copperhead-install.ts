import { createRequire } from 'node:module';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { run } from '../util/exec.js';

export interface CopperheadInstall {
  root: string;
  version: string;
  commit: string;
  cliEntry: string;
}

let cached: CopperheadInstall | undefined;

/**
 * Resolves the copperhead installation this process will drive, and pins its
 * exact commit for the comparability stamp (STANDARD.md section 9, design
 * D8). copperhead's own run-start transcript event records its semver but
 * never a git commit, so this is the only source of one — which means it
 * requires copperhead to be installed from a git checkout (`npm link`, not a
 * registry tarball). result.schema.json types environment.copperheadCommit
 * as a required, non-null string (unlike kicadCliVersion, which allows null),
 * so there is no valid fallback: an install with no resolvable HEAD hard-
 * errors here rather than producing an invalid — or silently misleading —
 * result record.
 */
export async function resolveCopperheadInstall(): Promise<CopperheadInstall> {
  if (cached) return cached;
  const require = createRequire(import.meta.url);
  let pkgPath: string;
  try {
    pkgPath = require.resolve('copperhead/package.json');
  } catch {
    throw new Error(
      'copperhead is not resolvable from copperbench (no node_modules/copperhead). ' +
        'It is a peer dependency: run `npm link` inside a copperhead git checkout, then ' +
        '`npm link copperhead` inside copperbench.',
    );
  }
  const root = path.dirname(pkgPath);
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
    version: string;
    bin: string | Record<string, string>;
  };
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.copperhead;
  if (!binRel) {
    throw new Error(`copperhead's package.json at ${pkgPath} has no "copperhead" bin entry`);
  }

  // dist/cli.js, not src/, is what actually runs — so it has to be checked
  // against the commit we're about to stamp, not assumed current. A stale
  // build (caught in practice: a leftover config field compiled into dist/
  // that no longer exists in src/) would otherwise stamp every result with a
  // commit that describes code other than what ran, silently.
  const [srcNewest, distNewest] = await Promise.all([
    newestMtimeMs(path.join(root, 'src'), '.ts'),
    newestMtimeMs(path.join(root, 'dist'), '.js'),
  ]);
  if (srcNewest > distNewest) {
    throw new Error(
      `copperhead at ${root} has a stale dist/: src/ contains a change newer than the newest compiled ` +
        'dist/ file, so dist/cli.js (what actually runs) may not match HEAD. Run `npm run build` inside ' +
        'the copperhead checkout, then retry — a wrong copperheadCommit stamp is worse than a slow one.',
    );
  }

  let commit: string;
  try {
    const { stdout } = await run('git', ['-C', root, 'rev-parse', 'HEAD']);
    commit = stdout.trim();
  } catch {
    throw new Error(
      `copperhead at ${root} is not a git checkout (no HEAD commit resolvable). copperbench requires ` +
        'copperhead installed from a git checkout rather than a registry tarball, because ' +
        'environment.copperheadCommit is a required, non-null field in every result record ' +
        "(STANDARD.md section 9) and copperhead's own transcript never records one. Install from " +
        'a git clone and `npm link` it instead.',
    );
  }

  // A dirty working tree means the code actually running (dist/, built from
  // whatever's on disk right now) doesn't correspond to ANY commit — a
  // rebuild-but-forgot-to-commit variant of the stale-dist problem above,
  // and the mtime check can't catch it (dist can be perfectly fresh relative
  // to a dirty src/). Found in practice: a fix landed in src/ and dist/ was
  // rebuilt before the commit was made, which would have stamped every
  // result with a commit that predates the code that actually ran.
  const { stdout: statusOut } = await run('git', ['-C', root, 'status', '--porcelain']);
  if (statusOut.trim().length > 0) {
    throw new Error(
      `copperhead at ${root} has uncommitted changes, so HEAD (${commit}) does not describe the code ` +
        'currently in dist/. Commit or stash them before running — an uncommitted copperheadCommit ' +
        'stamp is not "slightly stale", it is not a real answer at all.',
    );
  }

  cached = { root, version: pkg.version, commit, cliEntry: path.join(root, binRel) };
  return cached;
}

/** Test helper: clear the memoized install so a test can point elsewhere. */
export function resetCopperheadInstallCache(): void {
  cached = undefined;
}

async function newestMtimeMs(dir: string, ext: string): Promise<number> {
  let newest = -Infinity;
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        const st = await stat(full);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      }
    }
  }
  await walk(dir);
  return newest;
}
