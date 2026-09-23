/**
 * Key-path diff. Reports paths only (never values), so the output is safe for
 * the audit log. Arrays are compared index by index.
 */
import { formatPath, isPlainObject, type PathSeg } from './json';
import { deepEqual } from './merge-patch';

export type Change = { path: string; kind: 'added' | 'removed' | 'changed' };

export function diffPaths(before: unknown, after: unknown): Change[] {
	const out: Change[] = [];
	const visit = (a: unknown, b: unknown, segs: PathSeg[]) => {
		if (deepEqual(a, b)) return;
		if (isPlainObject(a) && isPlainObject(b)) {
			const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
			for (const k of keys) {
				const inA = a[k] !== undefined;
				const inB = b[k] !== undefined;
				if (inA && !inB) out.push({ path: formatPath([...segs, k]), kind: 'removed' });
				else if (!inA && inB) out.push({ path: formatPath([...segs, k]), kind: 'added' });
				else if (inA && inB) visit(a[k], b[k], [...segs, k]);
			}
			return;
		}
		if (Array.isArray(a) && Array.isArray(b)) {
			const n = Math.max(a.length, b.length);
			for (let i = 0; i < n; i++) {
				if (i >= a.length) out.push({ path: formatPath([...segs, i]), kind: 'added' });
				else if (i >= b.length) out.push({ path: formatPath([...segs, i]), kind: 'removed' });
				else visit(a[i], b[i], [...segs, i]);
			}
			return;
		}
		out.push({ path: formatPath(segs) || '(root)', kind: 'changed' });
	};
	visit(before, after, []);
	return out;
}
