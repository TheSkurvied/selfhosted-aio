import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	bulk,
	createPerson,
	importAiometadata,
	importAiostreams,
	listAiometadataCandidates,
	listPeople,
	listTemplates,
	setBinding
} from '$lib/server/services';
import {
	actorOf,
	attempt,
	badInput,
	bool,
	optStr,
	str,
	tagsOf,
	KINDS
} from '../_lib/helpers.server';
import { plural } from '../_lib/format';

const STATUSES = ['in_sync', 'pending', 'drifted', 'missing', 'error', 'unbound', 'never_pushed'];

export const load: PageServerLoad = async ({ url, depends }) => {
	depends('app:people', 'app:sync');
	const search = url.searchParams.get('q')?.trim() || undefined;
	const tag = url.searchParams.get('tag') || undefined;
	const statusParam = url.searchParams.get('status');
	const status = statusParam && STATUSES.includes(statusParam) ? statusParam : undefined;

	const [all, templates] = await Promise.all([listPeople(), listTemplates()]);
	let people = search || tag ? await listPeople({ search, tag }) : all;
	if (status) {
		people = people.filter((p) =>
			KINDS.some((k) => (p.bindings[k]?.status ?? 'unbound') === status)
		);
	}
	const tags = [...new Set(all.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b));
	return {
		people,
		total: all.length,
		tags,
		filters: { q: search ?? '', tag: tag ?? '', status: status ?? '' },
		templates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			kind: t.kind,
			currentVersion: t.currentVersion
		}))
	};
};

async function bindInitial(actor: string, personId: string, fd: FormData) {
	for (const kind of KINDS) {
		const templateId = optStr(fd, `template_${kind}`);
		if (templateId)
			await setBinding(actor, personId, kind, { templateId, pinnedVersionId: null, overrides: {} });
	}
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const fd = await request.formData();
		const actor = actorOf(locals);
		const res = await attempt(async () => {
			const displayName = str(fd, 'displayName');
			if (!displayName) throw badInput('Name is required');
			const { id } = await createPerson(actor, {
				displayName,
				notes: optStr(fd, 'notes'),
				tags: tagsOf(fd)
			});
			await bindInitial(actor, id, fd);
			return { id };
		}, 'create person');
		if ('id' in res) redirect(303, `/people/${res.id}?created=1`);
		return res;
	},

	bulk: async ({ request, locals }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const op = str(fd, 'op');
			if (op !== 'push' && op !== 'check') throw badInput('Unknown bulk action');
			const ids = fd.getAll('id').filter((v): v is string => typeof v === 'string' && v !== '');
			if (!ids.length) throw badInput('Select at least one person');
			const { jobIds } = await bulk(actorOf(locals), op, ids);
			return {
				message: `Queued ${plural(jobIds.length, op === 'push' ? 'push' : 'check')} for ${plural(ids.length, 'person', 'people')}`
			};
		}, 'bulk');
	},

	importStreams: async ({ request, locals }) => {
		const fd = await request.formData();
		const res = await attempt(async () => {
			const uuid = str(fd, 'uuid');
			const password = typeof fd.get('password') === 'string' ? (fd.get('password') as string) : '';
			if (!uuid || !password) throw badInput('Enter the config uuid and its password');
			const personId = optStr(fd, 'personId');
			const displayName = optStr(fd, 'displayName');
			if (!personId && !displayName) throw badInput('Pick a person or enter a name');
			return importAiostreams(actorOf(locals), {
				uuid,
				password,
				personId,
				displayName: personId ? undefined : displayName,
				templateId: optStr(fd, 'templateId')
			});
		}, 'import aiostreams');
		if ('personId' in res) redirect(303, `/people/${res.personId}?imported=aiostreams`);
		return res;
	},

	candidates: async () =>
		attempt(async () => ({ candidates: await listAiometadataCandidates() }), 'list candidates'),

	importMetadata: async ({ request, locals }) => {
		const fd = await request.formData();
		const res = await attempt(async () => {
			const uuid = str(fd, 'uuid');
			if (!uuid) throw badInput('Pick a configuration to import');
			if (!bool(fd, 'confirm'))
				throw badInput('Confirm that the old AIOMetadata password will stop working');
			const personId = optStr(fd, 'personId');
			const displayName = optStr(fd, 'displayName');
			if (!personId && !displayName) throw badInput('Pick a person or enter a name');
			return importAiometadata(actorOf(locals), {
				uuid,
				personId,
				displayName: personId ? undefined : displayName,
				templateId: optStr(fd, 'templateId')
			});
		}, 'import aiometadata');
		if ('personId' in res) redirect(303, `/people/${res.personId}?imported=aiometadata`);
		return res;
	}
};
