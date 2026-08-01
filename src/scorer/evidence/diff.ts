import { run } from '../../util/exec.js';

export interface FileDelta {
  path: string;
  added: number;
  removed: number;
}

export interface DiffEvidence {
  /** Tracked files with a diff from the baseline commit to the CURRENT
   * WORKING TREE (not HEAD) — see the note on git invocation below. */
  changedFiles: FileDelta[];
  /** New files not yet added to the index. */
  untrackedFiles: string[];
  /** Commits made since the baseline (git log baseline..HEAD) — only actual
   * commits count here, unlike changedFiles/untrackedFiles above. */
  commitCount: number;
}

/**
 * STANDARD.md section 4 / design D3: `git diff <baseline-sha>..HEAD plus the
 * untracked-file set`. Implemented as `git diff <baseline-sha>` (ONE ref,
 * not a range) deliberately: with a single ref, git compares that commit
 * against the current WORKING TREE, capturing staged, unstaged, AND
 * committed changes in one pass. A `baseline..HEAD` range would show nothing
 * for a run the runner SIGKILL'd mid-edit for exceeding caps.wallClockSec
 * (design D5/3.2) — HEAD never moved, but the working tree is genuinely
 * dirty — which would make file_unchanged/files_touched_subset spuriously
 * pass on a run we know was interrupted mid-edit. A successful run that
 * committed, or a refusal/rollback that restored the tree exactly (both of
 * which leave HEAD at baseline with a clean working tree), are read
 * identically either way, so this is strictly more correct, not different
 * in the common case.
 */
export async function readDiffEvidence(sandboxPath: string, baselineCommit: string): Promise<DiffEvidence> {
  const [numstat, untrackedRaw, logRaw] = await Promise.all([
    run('git', ['diff', baselineCommit, '--numstat'], { cwd: sandboxPath }),
    run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: sandboxPath }),
    run('git', ['log', `${baselineCommit}..HEAD`, '--oneline'], { cwd: sandboxPath }),
  ]);

  const changedFiles: FileDelta[] = numstat.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => {
      const [added, removed, ...pathParts] = line.split('\t');
      return {
        // git's plumbing output always uses '/' regardless of OS, but
        // normalized defensively anyway — cheap insurance against any path
        // this module ever builds itself, not just what git reports.
        path: pathParts.join('\t').trim().replace(/\\/g, '/'),
        // '-'/'-' marks a binary file in --numstat; treated as 0/0 since a
        // line-based ratio has nothing to divide for a binary diff.
        added: added === '-' ? 0 : Number(added),
        removed: removed === '-' ? 0 : Number(removed),
      };
    });

  const untrackedFiles = untrackedRaw.stdout
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.trim().replace(/\\/g, '/'));

  const commitCount = logRaw.stdout.split('\n').filter((l) => l.trim()).length;

  return { changedFiles, untrackedFiles, commitCount };
}

function countLines(content: string): number {
  if (content === '') return 0;
  const trimmed = content.endsWith('\n') ? content.slice(0, -1) : content;
  return trimmed.split('\n').length;
}

/**
 * Baseline line count for `diff_ratio_max`, read from the sandbox's own
 * baseline commit via `git show` rather than the original fixture directory
 * — self-contained for `--rescore` (a preserved sandbox carries its own
 * baseline blob) and correct regardless of line-ending convention, since the
 * same convention applies to both this count and the edited file's diff.
 */
export async function baselineLineCount(
  sandboxPath: string,
  baselineCommit: string,
  relPath: string,
): Promise<number> {
  const { stdout } = await run('git', ['show', `${baselineCommit}:${relPath}`], { cwd: sandboxPath });
  return countLines(stdout);
}
