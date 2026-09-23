<script lang="ts">
	import { Button, Callout, CopyButton, Icon, QrCode } from '$lib/ui';

	let { data } = $props();

	const ABOUT = {
		aiometadata: {
			title: 'Metadata',
			sub: 'AIOMetadata',
			text: 'Posters, descriptions and catalogs.'
		},
		aiostreams: { title: 'Streams', sub: 'AIOStreams', text: 'The links that actually play.' }
	} as const;

	let qrOpen = $state<Record<string, boolean>>({});
	const hasMeta = $derived(data.links.some((l) => l.kind === 'aiometadata'));
	const multiple = $derived(data.links.length > 1);

	function fmt(d: Date | string) {
		return new Date(d).toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>Stremio setup for {data.displayName}</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main class="share">
	<div class="col">
		<p class="brand"><span class="logo" aria-hidden="true">A</span> AIO Manager</p>
		<span class="page-ic"><Icon name="link" size={40} strokeWidth={1.25} /></span>
		<h1>Stremio setup for {data.displayName}</h1>
		<p class="lead">
			{#if multiple}
				Add these {data.links.length} addons to Stremio, in this order. Each one takes a single tap.
			{:else}
				Add this addon to Stremio. It takes a single tap.
			{/if}
		</p>

		{#if data.links.length === 0}
			<Callout color="yellow" title="Nothing to install yet">
				Your setup is still being prepared. Try this link again later.
			</Callout>
		{/if}

		<ol class="steps">
			{#each data.links as l, i (l.kind)}
				{@const a = ABOUT[l.kind]}
				<li class="step">
					<span class="num" aria-hidden="true">{i + 1}</span>
					<div class="body">
						<h2>{a.title} <span class="sub">{a.sub}</span></h2>
						<p class="muted">{a.text}</p>
						<div class="actions">
							<Button href={l.stremioUrl} variant="primary" icon="download" rel="noreferrer"
								>Install in Stremio</Button
							>
							<CopyButton
								value={l.manifestUrl}
								label="Copy manifest URL"
								copiedMessage="Manifest URL copied"
							/>
							<Button
								variant="ghost"
								icon="qr"
								aria-expanded={!!qrOpen[l.kind]}
								aria-controls="qr-{l.kind}"
								onclick={() => (qrOpen[l.kind] = !qrOpen[l.kind])}
								>{qrOpen[l.kind] ? 'Hide QR code' : 'QR code'}</Button
							>
						</div>
						{#if qrOpen[l.kind]}
							<div class="qr" id="qr-{l.kind}">
								<QrCode svg={l.qrSvg} size={196} label="QR code for the {a.sub} manifest" />
								<p class="faint small">
									Scan with a phone or TV that has Stremio, or open the link it shows.
								</p>
							</div>
						{/if}
					</div>
				</li>
			{/each}
		</ol>

		{#if data.links.length}
			<section class="howto" aria-labelledby="howto-h">
				<h2 id="howto-h">How to install</h2>
				<ul>
					<li>Open Stremio on this device and sign in.</li>
					{#if hasMeta && multiple}
						<li>Install <strong>Metadata</strong> first, then <strong>Streams</strong>.</li>
					{/if}
					{#if hasMeta}
						<li>
							If Stremio asks whether to remove <strong>Cinemeta</strong>, say yes. Metadata
							replaces it.
						</li>
					{/if}
					<li>
						"Install in Stremio" not working? Copy the manifest URL, then in Stremio open Addons,
						paste it into the search box and press Install.
					</li>
				</ul>
			</section>
		{/if}

		<p class="foot faint">
			<Icon name="clock" size={14} />
			{#if data.expiresAt}
				This link expires on {fmt(data.expiresAt)}. Your addons keep working after that.
			{:else}
				This link does not expire. Keep it private: anyone with it can install your addons.
			{/if}
		</p>
	</div>
</main>

<style>
	.share {
		min-height: 100vh;
		background: var(--bg);
		color: var(--text);
		padding: 56px 16px 72px;
	}
	.col {
		max-width: 620px;
		margin: 0 auto;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 0 48px;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.logo {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 4px;
		background: var(--text);
		color: var(--bg);
		font-size: 12px;
		font-weight: 700;
	}
	.page-ic {
		display: inline-flex;
		color: var(--text-secondary);
		margin-bottom: 12px;
	}
	h1 {
		margin: 0;
		font-size: 36px;
		line-height: 1.2;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.lead {
		margin: 10px 0 32px;
		font-size: 17px;
		color: var(--text-secondary);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.step {
		display: flex;
		gap: 16px;
		padding: 20px;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 50%;
		background: var(--bg-hover);
		font-size: 14px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	h2 {
		margin: 2px 0 2px;
		font-size: 18px;
		font-weight: 600;
	}
	.sub {
		margin-left: 6px;
		font-size: 13px;
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.body > p {
		margin: 0 0 14px;
		font-size: 15px;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.qr {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: 16px;
	}
	.small {
		font-size: 13px;
		margin: 0;
		max-width: 240px;
	}
	.howto {
		margin-top: 36px;
		padding: 16px 20px;
		border-radius: var(--radius-lg);
		background: var(--callout-gray);
	}
	.howto h2 {
		font-size: 16px;
		margin: 0 0 8px;
	}
	.howto ul {
		margin: 0;
		padding-left: 20px;
		font-size: 15px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.foot {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 28px 0 0;
		font-size: 14px;
	}
	.foot :global(svg) {
		margin-top: 3px;
		flex: none;
	}
	@media (max-width: 520px) {
		.share {
			padding-top: 28px;
		}
		.brand {
			margin-bottom: 32px;
		}
		h1 {
			font-size: 28px;
		}
		.step {
			padding: 16px;
			gap: 12px;
		}
		.actions :global(.btn) {
			flex: 1 1 100%;
			justify-content: center;
		}
		.qr {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
