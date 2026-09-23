import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	adoptRemote,
	checkBinding,
	createShareToken,
	deletePerson,
	deleteSecret,
	diffRemote,
	getPerson,
	getTemplate,
	listTemplates,
	pushBinding,
	removeBinding,
	renderPreview,
	revokePerson,
	revokeShareToken,
	rotateBinding,
	setBinding,
	setSecret,
	updatePerson
} from '$lib/server/services';
import {
	actorOf,
	attempt,
	badInput,
	bool,
	isServiceError,
	jsonObject,
	kindOf,
	optInt,
	settle,
	str,
	tagsOf,
	KINDS,
	type Kind,
	type Settled
} from '../../_lib/helpers.server';
import { KIND_LABEL, plural } from '../../_lib/format';

const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const load: PageServerLoad = async ({ params, depends }) => {
	depends('app:person', 'app:jobs', 'app:sync');
	let person: Awaited<ReturnType<typeof getPerson>>;
	try {
		person = await getPerson(params.id);
	} catch (e) {
		if (isServiceError(e) && e.status === 404) error(404, 'Person not found');
		throw e;
	}
	const templates = await listTemplates();
	// Version lists for the pickers (small numbers of templates in practice).
	const details = await Promise.all(
		templates.map((t) =>
			getTemplate(t.id)
				.then((d) => ({
					id: t.id,
					name: t.name,
					kind: t.kind,
					currentVersion: t.currentVersion,
					versions: d.versions.map((v) => ({ id: v.id, version: v.version, note: v.note }))
				}))
				.catch(() => ({
					id: t.id,
					name: t.name,
					kind: t.kind,
					currentVersion: t.currentVersion,
					versions: []
				}))
		)
	);
	// Rendering reads secrets; stream it so the page shows immediately.
	const previews: Partial<Record<Kind, Promise<Settled<Preview>>>> = {};
	for (const k of KINDS) if (person.bindings[k]) previews[k] = settle(renderPreview(person.id, k));
	return { person, templates: details, previews };
};

type Preview = Awaited<ReturnType<typeof renderPreview>>;

function kindFrom(fd: FormData) {
	return kindOf(str(fd, 'kind'));
}

export const actions: Actions = {
	update: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const patch: { displayName?: string; notes?: string; tags?: string[]; disabled?: boolean } =
				{};
			if (fd.has('displayName')) {
				const n = str(fd, 'displayName');
				if (!n) throw badInput('Name cannot be empty');
				patch.displayName = n;
			}
			if (fd.has('notes')) patch.notes = str(fd, 'notes');
			if (fd.has('tagsField')) patch.tags = tagsOf(fd);
			if (fd.has('disabled')) patch.disabled = bool(fd, 'disabled');
			await updatePerson(actorOf(locals), params.id, patch);
			return {};
		}, 'update person');
	},

	saveBinding: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			const templateId = str(fd, 'templateId');
			if (!templateId) throw badInput('Pick a template');
			const version = str(fd, 'version');
			const overrides = fd.has('overrides') ? jsonObject(fd, 'overrides', 'Overrides') : {};
			await setBinding(actorOf(locals), params.id, kind, {
				templateId,
				pinnedVersionId: version && version !== 'latest' ? version : null,
				overrides
			});
			return { message: `${KIND_LABEL[kind]} binding saved` };
		}, 'save binding');
	},

	push: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			const { jobId } = await pushBinding(actorOf(locals), params.id, kind);
			return { message: `Push to ${KIND_LABEL[kind]} queued`, jobId };
		}, 'push');
	},

	check: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			const { jobId } = await checkBinding(actorOf(locals), params.id, kind);
			return { message: `Check of ${KIND_LABEL[kind]} queued`, jobId };
		}, 'check');
	},

	rotate: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			const { jobId } = await rotateBinding(actorOf(locals), params.id, kind);
			return { message: `Rotation of ${KIND_LABEL[kind]} queued`, jobId };
		}, 'rotate');
	},

	adopt: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			await adoptRemote(actorOf(locals), params.id, kind);
			return { message: `Adopted the ${KIND_LABEL[kind]} config as overrides` };
		}, 'adopt');
	},

	diff: async ({ request, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			return { kind, diff: await diffRemote(params.id, kind) };
		}, 'diff');
	},

	removeBinding: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const kind = kindFrom(fd);
			const deleteUpstream = bool(fd, 'deleteUpstream');
			await removeBinding(actorOf(locals), params.id, kind, { deleteUpstream });
			return {
				message: deleteUpstream
					? `${KIND_LABEL[kind]} binding removed and config deleted upstream`
					: `${KIND_LABEL[kind]} binding removed`
			};
		}, 'remove binding');
	},

	setSecret: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const name = str(fd, 'name');
			const value = typeof fd.get('value') === 'string' ? (fd.get('value') as string) : '';
			if (!SECRET_NAME.test(name))
				throw badInput(
					'Secret names start with a letter or digit and use letters, digits, dot, dash or underscore'
				);
			if (!value) throw badInput('Enter a value');
			await setSecret(actorOf(locals), 'person', params.id, name, value);
			return { message: `Secret ${name} saved` };
		}, 'set secret');
	},

	deleteSecret: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const name = str(fd, 'name');
			await deleteSecret(actorOf(locals), 'person', params.id, name);
			return { message: `Secret ${name} removed` };
		}, 'delete secret');
	},

	createShare: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const expiresInDays = optInt(fd, 'expiresInDays', 'Expiry');
			const maxViews = optInt(fd, 'maxViews', 'Max views');
			const { id, url } = await createShareToken(actorOf(locals), params.id, {
				expiresInDays,
				maxViews
			});
			return { message: 'Share link created', share: { id, url } };
		}, 'create share');
	},

	revokeShare: async ({ request, locals }) => {
		const fd = await request.formData();
		return attempt(async () => {
			await revokeShareToken(actorOf(locals), str(fd, 'tokenId'));
			return { message: 'Share link revoked' };
		}, 'revoke share');
	},

	revoke: async ({ locals, params }) =>
		attempt(async () => {
			const { jobIds } = await revokePerson(actorOf(locals), params.id);
			return {
				message: `Access revoked. ${plural(jobIds.length, 'upstream delete')} queued`
			};
		}, 'revoke person'),

	delete: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const res = await attempt(async () => {
			await deletePerson(actorOf(locals), params.id, {
				deleteUpstream: bool(fd, 'deleteUpstream')
			});
			return { deleted: true as const };
		}, 'delete person');
		if ('deleted' in res) redirect(303, '/people');
		return res;
	}
};
