// Version and build info: package version, git commit, branch and build date.
// Sources: MM_COMMIT/MM_BUILD_DATE (CI images), /app/.buildinfo (local image
// builds, copied from .git), or the checkout itself when running from source.
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));
const read = (rel) => {
  try {
    return fs.readFileSync(new URL(rel, root), 'utf8').trim();
  } catch {
    return '';
  }
};

// Resolve HEAD → commit in a (possibly partial) .git directory.
function gitInfo(dir) {
  const head = read(`${dir}/HEAD`);
  if (!head) return null;
  if (/^[0-9a-f]{40}$/.test(head)) return { commit: head, branch: null };
  const ref = head.replace(/^ref:\s*/, '');
  const commit = read(`${dir}/${ref}`) || read(`${dir}/packed-refs`).split('\n').find((l) => l.endsWith(` ${ref}`))?.split(' ')[0] || '';
  return /^[0-9a-f]{40}$/.test(commit) ? { commit, branch: ref.replace(/^refs\/heads\//, '') } : null;
}

const fromEnv = process.env.MM_COMMIT && /^[0-9a-f]{7,40}$/.test(process.env.MM_COMMIT) ? { commit: process.env.MM_COMMIT, branch: null } : null;
const git = fromEnv || gitInfo('.buildinfo') || gitInfo('.git');
const repo = String(pkg.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');

export const BUILD = {
  version: pkg.version,
  commit: git?.commit || null,
  shortCommit: git?.commit?.slice(0, 7) || null,
  branch: git?.branch || null,
  builtAt: process.env.MM_BUILD_DATE || read('.buildinfo/built') || null,
  source: fromEnv ? 'release' : git ? 'local' : 'dev',
  commitUrl: git && repo ? `${repo}/commit/${git.commit}` : null,
};

// Changes with every build – open mirrors reload when it differs.
export const VERSION = `${pkg.version}+${BUILD.shortCommit || process.env.MM_VERSION || 'dev'}`;
