import type { LayoutServerLoad } from './$types';

// Minimal version created by DESIGN; PAGES owns this file and may extend it.
export const load: LayoutServerLoad = async ({ locals }) => {
	return { admin: locals.admin };
};
