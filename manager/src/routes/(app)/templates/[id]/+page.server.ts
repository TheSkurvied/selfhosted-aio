import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	deleteTemplate,
	dryRunTemplate,
	extractSecrets,
	getTemplate,
	getTemplateVersion,
	pushTemplate,
	saveTemplateVersion,
	updateTemplateMeta,
	validateTemplateBody
} from '$lib/server/services';
import {
	actorOf,
	attempt,
	badInput,
	isServiceError,
	jsonObject,
	optStr,
	str
} from '../../_lib/helpers.server';
import { applyExtract, extractFound } from '../../_lib/extract.server';
import { plural } from '../../_lib/format';

export const load: PageServerLoad = async ({ params, depends }) => {
	depends('app:template');
	try {
		return { template: await getTemplate(params.id) };
	} catch (e) {
		if (isServiceError(e) && e.status === 404) error(404, 'Template not found');
		throw e;
	}
};

async function kindOfTemplate(id: string) {
	return (await getTemplate(id)).kind;
}

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const body = jsonObject(fd, 'body', 'Body');
			const { found } = extractSecrets(body);
			if (found.length)
				throw badInput(
					`The body has ${plural(found.length, 'value')} that look like a key (${found
						.slice(0, 3)
						.map((f) => f.path)
						.join(', ')}). Use "Extract secrets" first.`
				);
			const { version } = await saveTemplateVersion(actorOf(locals), params.id, {
				body,
				note: optStr(fd, 'note')
			});
			return { message: `Saved v${version}`, saved: version };
		}, 'save template version');
	},

	validate: async ({ request, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const body = jsonObject(fd, 'body', 'Body');
			const res = validateTemplateBody(await kindOfTemplate(params.id), body);
			const { found } = extractSecrets(body);
			return { validation: { ...res, rawSecrets: found.length } };
		}, 'validate');
	},

	version: async ({ request, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const v = await getTemplateVersion(params.id, str(fd, 'versionId'));
			return {
				version: {
					id: v.id,
					version: v.version,
					note: v.note,
					requiredSecrets: v.requiredSecrets,
					body: v.body
				}
			};
		}, 'load version');
	},

	dryRun: async ({ params }) =>
		attempt(async () => ({ dryRun: await dryRunTemplate(params.id) }), 'dry run'),

	push: async ({ locals, params }) =>
		attempt(async () => {
			const { jobIds } = await pushTemplate(actorOf(locals), params.id);
			return {
				message: jobIds.length ? `Queued ${plural(jobIds.length, 'push')}` : 'Nobody to push',
				jobIds
			};
		}, 'push template'),

	meta: async ({ request, locals, params }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const name = str(fd, 'name');
			if (!name) throw badInput('Name is required');
			await updateTemplateMeta(actorOf(locals), params.id, {
				name,
				description: str(fd, 'description')
			});
			return { message: 'Details saved' };
		}, 'update template');
	},

	delete: async ({ locals, params }) => {
		const res = await attempt(async () => {
			await deleteTemplate(actorOf(locals), params.id);
			return { deleted: true as const };
		}, 'delete template');
		if ('deleted' in res) redirect(303, '/templates');
		return res;
	},

	extract: async ({ request }) => {
		const fd = await request.formData();
		return attempt(async () => extractFound(fd), 'extract');
	},

	applyExtract: async ({ request, locals }) => {
		const fd = await request.formData();
		return attempt(async () => applyExtract(fd, actorOf(locals)), 'apply extract');
	}
};
