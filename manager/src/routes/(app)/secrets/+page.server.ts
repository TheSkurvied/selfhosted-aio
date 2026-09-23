import type { Actions, PageServerLoad } from './$types';
import { deleteSecret, listSharedSecrets, setSecret } from '$lib/server/services';
import { actorOf, attempt, badInput, str } from '../_lib/helpers.server';

const SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export const load: PageServerLoad = async () => ({ secrets: await listSharedSecrets() });

export const actions: Actions = {
	set: async ({ request, locals }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const name = str(fd, 'name');
			const value = typeof fd.get('value') === 'string' ? (fd.get('value') as string) : '';
			if (!SECRET_NAME.test(name))
				throw badInput(
					'Secret names start with a letter or digit and use letters, digits, dot, dash or underscore'
				);
			if (!value) throw badInput('Enter a value');
			await setSecret(actorOf(locals), 'shared', null, name, value);
			return { message: `Shared secret ${name} saved` };
		}, 'set shared secret');
	},
	delete: async ({ request, locals }) => {
		const fd = await request.formData();
		return attempt(async () => {
			const name = str(fd, 'name');
			await deleteSecret(actorOf(locals), 'shared', null, name);
			return { message: `Shared secret ${name} deleted` };
		}, 'delete shared secret');
	}
};
