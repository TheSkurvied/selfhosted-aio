<script lang="ts">
	import { Button, Callout, Checkbox, EmptyState, Input, Modal, Spinner } from '$lib/ui';
	import { callAction } from './forms.svelte';

	interface Props {
		open?: boolean;
		/** Current editor text. */
		body: string;
		/** Receives the new body text with placeholders. */
		onapply: (body: string, info: { replaced: number; saved: number }) => void;
	}
	let { open = $bindable(false), body, onapply }: Props = $props();

	type Row = { path: string; name: string; hint: string; include: boolean; save: boolean };
	let rows = $state<Row[] | null>(null);
	let error = $state<string | null>(null);
	let applying = $state(false);

	$effect(() => {
		if (open) void scan();
	});

	async function scan() {
		rows = null;
		error = null;
		try {
			const res = await callAction<{
				found: Array<{ path: string; suggestedName: string; hint: string }>;
			}>('?/extract', { body });
			rows = res.found.map((f) => ({
				path: f.path,
				name: f.suggestedName,
				hint: f.hint,
				include: true,
				save: false
			}));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Scan failed';
			rows = [];
		}
	}

	const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
	const picked = $derived((rows ?? []).filter((r) => r.include));
	const invalid = $derived(picked.some((r) => !NAME.test(r.name.trim())));

	async function apply() {
		applying = true;
		error = null;
		try {
			const res = await callAction<{ body: string; replaced: number; saved: number }>(
				'?/applyExtract',
				{
					body,
					picks: JSON.stringify(
						picked.map((r) => ({ path: r.path, name: r.name.trim(), save: r.save }))
					)
				}
			);
			onapply(res.body, { replaced: res.replaced, saved: res.saved });
			open = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not apply';
		} finally {
			applying = false;
		}
	}
</script>

<Modal
	bind:open
	title="Extract secrets"
	description="Values that look like keys are replaced with named placeholders, so the template never stores a raw key."
	size="lg"
>
	{#if error}<Callout color="red">{error}</Callout>{/if}
	{#if rows === null}
		<div class="scan" role="status"><Spinner size={14} /> Scanning...</div>
	{:else if rows.length === 0 && !error}
		<EmptyState
			compact
			icon="shield"
			title="Nothing found"
			description="No values that look like API keys or tokens. Placeholders already in the body are left alone."
		/>
	{:else if rows.length}
		<ul class="found">
			{#each rows as r (r.path)}
				<li class:off={!r.include}>
					<Checkbox bind:checked={r.include} aria-label="Replace {r.path}" />
					<div class="info">
						<code class="path mono">{r.path}</code>
						<span class="hint mono faint">{r.hint}</span>
					</div>
					<div class="name">
						<Input
							size="sm"
							mono
							bind:value={r.name}
							aria-label="Placeholder name for {r.path}"
							disabled={!r.include}
							error={r.include && !NAME.test(r.name.trim()) ? 'Letters, digits, . _ -' : null}
						/>
					</div>
					<div class="save">
						<Checkbox bind:checked={r.save} disabled={!r.include} label="Save as shared" />
					</div>
				</li>
			{/each}
		</ul>
		<p class="faint note">
			"Save as shared" stores the value as a shared secret for everyone using the template. Leave it
			off for keys that belong to one person and set those on the person's page.
		</p>
	{/if}
	{#snippet footer()}
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			disabled={!picked.length || invalid}
			loading={applying}
			onclick={apply}>Replace {picked.length || ''} with placeholders</Button
		>
	{/snippet}
</Modal>

<style>
	.scan {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		color: var(--text-secondary);
	}
	.found {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		max-height: 360px;
		overflow: auto;
	}
	li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 200px auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
	}
	li + li {
		border-top: 1px solid var(--divider);
	}
	li.off .info {
		opacity: 0.5;
	}
	.info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.path {
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: none;
		padding: 0;
	}
	.hint {
		font-size: 12px;
	}
	.save {
		font-size: 13px;
		white-space: nowrap;
	}
	.note {
		font-size: 12px;
		margin: 10px 0 0;
	}
	@media (max-width: 640px) {
		li {
			grid-template-columns: auto minmax(0, 1fr);
		}
		.name,
		.save {
			grid-column: 2;
		}
	}
</style>
