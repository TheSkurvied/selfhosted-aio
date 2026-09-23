<script lang="ts">
	import {
		Button,
		IconButton,
		Input,
		Textarea,
		Select,
		Checkbox,
		Toggle,
		Tag,
		StatusTag,
		PageHeader,
		PropertyList,
		Property,
		Callout,
		ToggleBlock,
		Divider,
		EmptyState,
		Table,
		Tabs,
		CodeEditor,
		JsonView,
		Modal,
		Menu,
		Tooltip,
		Spinner,
		ProgressBar,
		Kbd,
		Breadcrumbs,
		CopyButton,
		QrCode,
		PageChrome,
		Icon,
		toast,
		theme,
		TAG_COLORS,
		SYNC_STATUS,
		tagColorFor,
		type SyncStatus,
		type TableColumn
	} from '$lib/ui';
	import { iconPaths, type IconName } from '$lib/icons/paths';

	const statuses = Object.keys(SYNC_STATUS) as SyncStatus[];
	const icons = Object.keys(iconPaths) as IconName[];

	interface PersonRow {
		id: string;
		name: string;
		tags: string[];
		streams: string;
		metadata: string;
		status: SyncStatus;
		updated: string;
	}

	const people: PersonRow[] = [
		{
			id: 'p1',
			name: 'Grandma',
			tags: ['family'],
			streams: 'Family v7',
			metadata: 'Family v3',
			status: 'in_sync',
			updated: 'Sep 20, 2026'
		},
		{
			id: 'p2',
			name: 'Sam',
			tags: ['anime'],
			streams: 'Anime fan v2',
			metadata: 'Anime fan v4',
			status: 'pending',
			updated: 'Sep 21, 2026'
		},
		{
			id: 'p3',
			name: 'Uncle Joe',
			tags: ['family', 'tv'],
			streams: 'Family v6 (pinned)',
			metadata: 'Family v3',
			status: 'drifted',
			updated: 'Sep 12, 2026'
		},
		{
			id: 'p4',
			name: 'Old laptop',
			tags: [],
			streams: '',
			metadata: 'Family v3',
			status: 'missing',
			updated: 'Aug 30, 2026'
		},
		{
			id: 'p5',
			name: 'Living room TV',
			tags: ['device'],
			streams: 'Family v7',
			metadata: '',
			status: 'never_pushed',
			updated: 'Sep 22, 2026'
		}
	];

	const columns: TableColumn[] = [
		{ key: 'name', label: 'Name', icon: 'text', width: '28%' },
		{ key: 'tags', label: 'Tags', icon: 'list', hideOnMobile: true },
		{ key: 'streams', label: 'Streams template', icon: 'template', hideOnMobile: true },
		{ key: 'metadata', label: 'Metadata template', icon: 'template', hideOnMobile: true },
		{ key: 'status', label: 'Status', icon: 'circle-dashed' },
		{ key: 'updated', label: 'Updated', icon: 'calendar', hideOnMobile: true }
	];

	let selected = $state<string[]>(['p2']);
	let tab = $state('components');
	let viewTab = $state('all');
	let modalOpen = $state(false);
	let dangerOpen = $state(false);
	let toggleOn = $state(true);
	let toggleOff = $state(false);
	let cbA = $state(true);
	let cbB = $state(false);
	let text = $state('');
	let selectVal = $state('latest');
	let blockOpen = $state(true);
	let editorValid = $state(true);

	let code = $state(`{
  "services": [
    {
      "id": "realdebrid",
      "enabled": true,
      "credentials": { "apiKey": "{{secret:rd_key}}" }
    }
  ],
  "formatter": { "id": "torbox" },
  "presets": []
}`);
	let badCode = $state(`{
  "formatter": { "id": "torbox" },
  "presets": [,]
}`);

	const sample = {
		services: [
			{ id: 'realdebrid', enabled: true, credentials: { apiKey: '••••1a2f' } },
			{ id: 'torbox', enabled: false, credentials: { apiKey: '{{secret:tb_key}}' } }
		],
		formatter: { id: 'torbox', compact: true },
		limits: { maxResults: 40, timeout: 6500 },
		excludedLanguages: [],
		notes: null
	};

	const qrSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h29v29H0z"/><path stroke="#000" d="M0 0.5h7m2 0h1m1 0h3m1 0h1m2 0h2m1 0h7M0 1.5h1m5 0h1m1 0h2m3 0h1m1 0h1m2 0h1m1 0h1m5 0h1M0 2.5h1m1 0h3m1 0h1m2 0h2m1 0h2m3 0h1m2 0h1m1 0h3m1 0h1M0 3.5h1m1 0h3m1 0h1m1 0h1m2 0h1m1 0h3m1 0h3m1 0h1m1 0h3m1 0h1M0 4.5h1m1 0h3m1 0h1m1 0h2m3 0h1m2 0h1m1 0h1m2 0h1m1 0h3m1 0h1M0 5.5h1m5 0h1m2 0h1m1 0h1m1 0h1m1 0h1m3 0h1m1 0h1m5 0h1M0 6.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M8 7.5h1m2 0h1m1 0h2m3 0h1M0 8.5h1m1 0h5m3 0h3m2 0h1m1 0h1m1 0h5M1 9.5h1m1 0h1m4 0h2m1 0h1m1 0h1m3 0h2m3 0h1m1 0h2M0 10.5h2m2 0h1m1 0h2m2 0h4m1 0h1m2 0h3m1 0h1m2 0h1M2 11.5h1m1 0h2m1 0h1m2 0h1m1 0h1m1 0h2m1 0h1m2 0h1m3 0h2M0 12.5h1m2 0h2m1 0h1m1 0h2m1 0h1m1 0h1m2 0h1m2 0h3m1 0h1m1 0h1M1 13.5h2m2 0h1m3 0h3m1 0h1m1 0h2m3 0h3m1 0h1M0 14.5h1m1 0h1m1 0h5m1 0h1m2 0h2m2 0h1m1 0h1m1 0h2m1 0h2M0 15.5h3m1 0h1m2 0h1m3 0h1m2 0h1m1 0h2m1 0h3m2 0h2M1 16.5h1m1 0h1m1 0h3m2 0h2m3 0h1m1 0h2m2 0h3M0 17.5h2m3 0h1m2 0h2m1 0h1m2 0h2m1 0h1m1 0h1m3 0h2M0 18.5h1m1 0h1m1 0h1m1 0h2m1 0h3m2 0h1m1 0h1m1 0h2m2 0h1m1 0h1M0 19.5h1m1 0h1m1 0h1m3 0h2m2 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h2M0 20.5h1m1 0h1m1 0h1m1 0h1m2 0h1m1 0h1m2 0h3m1 0h5m1 0h1M8 21.5h1m1 0h1m1 0h1m1 0h2m2 0h1m3 0h2M0 22.5h7m1 0h2m2 0h1m1 0h2m2 0h1m1 0h1m1 0h1m1 0h2M0 23.5h1m5 0h1m1 0h3m4 0h1m1 0h2m3 0h2m1 0h1M0 24.5h1m1 0h3m1 0h1m1 0h1m3 0h1m1 0h5m1 0h1m1 0h1M0 25.5h1m1 0h3m1 0h1m2 0h3m2 0h2m1 0h1m2 0h1m2 0h1M0 26.5h1m1 0h3m1 0h1m1 0h2m1 0h1m1 0h1m2 0h1m2 0h3m1 0h2M0 27.5h1m5 0h1m1 0h1m1 0h2m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h2M0 28.5h7m1 0h1m1 0h3m2 0h2m1 0h1m1 0h2m1 0h1m1 0h2"/></svg>`;

	const sections = [
		['foundations', 'Foundations'],
		['buttons', 'Buttons'],
		['forms', 'Form controls'],
		['tags', 'Tags and status'],
		['blocks', 'Page blocks'],
		['table', 'Database table'],
		['editing', 'Code and JSON'],
		['overlays', 'Overlays and feedback'],
		['nav', 'Navigation'],
		['icons', 'Icons']
	] as const;
</script>

<PageChrome
	title="Style guide"
	crumbs={[{ label: 'Settings', href: '/settings', icon: 'settings' }, { label: 'Style guide' }]}
>
	{#snippet actions()}
		<Button
			variant="ghost"
			size="sm"
			onclick={() => theme.toggle()}
			icon={theme.resolved === 'dark' ? 'sun' : 'moon'}
		>
			{theme.resolved === 'dark' ? 'Light' : 'Dark'}
		</Button>
		<Button variant="ghost" size="sm" icon="share">Share</Button>
		<Menu
			items={[
				{ label: 'Copy link', icon: 'link', hint: 'Ctrl+L', onselect: () => toast('Link copied') },
				{ label: 'Duplicate', icon: 'copy' },
				{ divider: true },
				{ label: 'Delete', icon: 'trash', danger: true, onselect: () => (dangerOpen = true) }
			]}
		/>
	{/snippet}
</PageChrome>

<div class="page">
	<PageHeader
		icon="template"
		title="Style guide"
		description="Every component in the AIO Manager design system, in the Notion style. Switch the theme from the top bar or the sidebar to check both."
	>
		{#snippet actions()}
			<Button icon="plus" variant="primary">New person</Button>
		{/snippet}
		<PropertyList>
			<Property label="Owner" icon="person">
				<span class="avatar-sm">A</span> admin@example.com
			</Property>
			<Property label="Status" icon="circle-dashed"><StatusTag status="in_sync" /></Property>
			<Property label="Tags" icon="list">
				<Tag color="blue" label="design" /><Tag color="purple" label="reference" />
			</Property>
			<Property label="Remote uuid" icon="hash" value="3f2c8e1a-0b7d-4c55-9d1e-6a4b2f0c1a91" mono />
			<Property label="Last push" icon="clock" value={null} empty="Never" />
		</PropertyList>
	</PageHeader>

	<Tabs
		bind:active={tab}
		tabs={[
			{ id: 'components', label: 'Components', icon: 'dashboard' },
			{ id: 'about', label: 'About', icon: 'info' }
		]}
	/>

	{#if tab === 'about'}
		<div class="section">
			<p class="muted">
				Tokens live in <code>src/app.css</code>; components in <code>src/lib/ui</code>. See
				<code>src/lib/ui/README.md</code> for the page chrome API.
			</p>
		</div>
	{:else}
		<nav class="toc" aria-label="Sections">
			{#each sections as [id, label] (id)}
				<a href="#{id}">{label}</a>
			{/each}
		</nav>

		<!-- Foundations -->
		<section class="section" id="foundations">
			<h2>Foundations</h2>
			<p class="lead">Warm neutral grays, hairline dividers and a single blue accent.</p>
			<div class="type-scale">
				<h1>Page title 40</h1>
				<h2>Heading 2, 24 semibold</h2>
				<h3>Heading 3, 18 semibold</h3>
				<p>
					Body 16/1.5. The manager keeps configs in sync with <a href="#foundations"
						>upstream instances</a
					>
					and never shows raw keys. Inline <code>code</code> looks like this.
				</p>
				<p class="small muted">
					Secondary 14 &middot; <span class="faint">Tertiary text</span> &middot;
					<span class="mono">mono 3f2c...a91</span>
				</p>
			</div>
			<div class="swatches">
				{#each [['--text', 'Text'], ['--text-secondary', 'Secondary'], ['--text-tertiary', 'Tertiary'], ['--bg', 'Page'], ['--bg-sidebar', 'Sidebar'], ['--bg-hover', 'Hover'], ['--bg-pressed', 'Pressed'], ['--divider', 'Divider'], ['--border-input', 'Input border'], ['--accent', 'Accent'], ['--danger', 'Danger']] as [v, label] (v)}
					<div class="swatch">
						<span class="chip" style:background="var({v})"></span>
						<span class="sw-label">{label}</span>
						<span class="sw-var">{v}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- Buttons -->
		<section class="section" id="buttons">
			<h2>Buttons</h2>
			<div class="demo">
				<div class="row">
					<Button variant="primary">Primary</Button>
					<Button>Default</Button>
					<Button variant="danger">Delete</Button>
					<Button variant="ghost">Ghost</Button>
					<Button disabled>Disabled</Button>
					<Button loading variant="primary">Saving</Button>
				</div>
				<div class="row">
					<Button size="sm" variant="primary" icon="plus">New</Button>
					<Button size="sm" icon="sync">Push</Button>
					<Button size="sm" icon="refresh">Check</Button>
					<Button size="sm" icon="rotate">Rotate</Button>
					<Button size="sm" variant="danger" icon="trash">Delete upstream</Button>
					<Button size="sm" variant="ghost" iconRight="chevron-down">Versions</Button>
					<Button size="sm" href="#buttons" icon="external-link">Link button</Button>
				</div>
				<div class="row">
					<IconButton icon="more-horizontal" label="More" />
					<IconButton icon="search" label="Search" />
					<IconButton icon="filter" label="Filter" />
					<IconButton icon="copy" label="Copy" size="sm" />
					<IconButton icon="settings" label="Settings" active />
					<CopyButton value="https://streams.example.com/manifest.json" label="Copy manifest URL" />
					<CopyButton value="secret" />
				</div>
			</div>
		</section>

		<!-- Forms -->
		<section class="section" id="forms">
			<h2>Form controls</h2>
			<div class="demo grid2">
				<Input
					label="Display name"
					placeholder="e.g. Grandma"
					bind:value={text}
					hint="Shown on the share page."
				/>
				<Input label="Search" icon="search" placeholder="Search people" size="sm" />
				<Input
					label="Email"
					type="email"
					value="not-an-email"
					error="Enter a valid email address."
				/>
				<Input label="Remote uuid" value="3f2c8e1a-0b7d" mono disabled />
				<Select
					label="Version"
					bind:value={selectVal}
					options={[
						{ value: 'latest', label: 'Latest (v7)' },
						{ value: 'v6', label: 'v6' },
						{ value: 'v5', label: 'v5' }
					]}
				/>
				<Select
					label="Template"
					placeholder="Choose a template"
					options={['Family', 'Anime fan', 'Minimal']}
					value=""
				/>
				<div class="full">
					<Textarea label="Notes" placeholder="Anything to remember about this person" rows={2} />
				</div>
				<div class="stack">
					<Checkbox bind:checked={cbA} label="Delete upstream config too" />
					<Checkbox
						bind:checked={cbB}
						label="Pin to this version"
						description="Future template versions will not be pushed."
					/>
					<Checkbox indeterminate label="Indeterminate" />
					<Checkbox disabled label="Disabled" />
				</div>
				<div class="stack">
					<Toggle bind:checked={toggleOn} label="Scheduled checks" description="Every 6 hours" />
					<Toggle bind:checked={toggleOff} label="Notify on drift" />
					<Toggle disabled label="Disabled" />
				</div>
			</div>
		</section>

		<!-- Tags -->
		<section class="section" id="tags">
			<h2>Tags and status</h2>
			<div class="demo">
				<div class="row">
					{#each TAG_COLORS as c (c)}<Tag color={c} label={c} />{/each}
					<Tag label="default" />
				</div>
				<div class="row">
					{#each statuses as s (s)}<StatusTag status={s} />{/each}
				</div>
				<div class="row">
					<Tag color="gray" label="removable" onremove={() => toast('Removed')} />
					<Tag color="green" icon="check" label="with icon" />
					<Tag size="sm" color={tagColorFor('family')} label="family (hashed)" />
					<Tag size="sm" color={tagColorFor('anime')} label="anime (hashed)" />
				</div>
			</div>
		</section>

		<!-- Blocks -->
		<section class="section" id="blocks">
			<h2>Page blocks</h2>
			<div class="stack" style:--stack-gap="16px">
				<Callout color="gray">
					Install Metadata first, then Streams, and remove Cinemeta if Stremio asks.
				</Callout>
				<Callout color="blue" title="Dry run"
					>12 people will change when you push version 8.</Callout
				>
				<Callout color="yellow" title="Missing secrets">
					Sam has no value for <code>rd_key</code> and there is no shared fallback.
					{#snippet actions()}<Button size="sm">Add secret</Button>{/snippet}
				</Callout>
				<Callout color="red" title="Push failed"
					>Upstream returned 502 Bad Gateway after 3 attempts.</Callout
				>
				<Callout color="green">All 21 configs are in sync.</Callout>

				<ToggleBlock title="AIOStreams" bind:open={blockOpen} heading>
					<PropertyList>
						<Property label="Template" icon="template" value="Anime fan v2" />
						<Property label="Status" icon="circle-dashed"><StatusTag status="pending" /></Property>
						<Property label="Created" icon="calendar" value="Aug 2, 2026" />
					</PropertyList>
				</ToggleBlock>
				<ToggleBlock title="Advanced options">
					<p class="small muted">Hidden content revealed by the caret.</p>
				</ToggleBlock>

				<Divider />
				<Divider label="or" />

				<div class="bordered">
					<EmptyState
						icon="people"
						title="No people yet"
						description="Add a person, then bind templates to create their configs."
					>
						{#snippet action()}
							<Button variant="primary" icon="plus" size="sm">Add person</Button>
							<Button size="sm" icon="upload">Import</Button>
						{/snippet}
					</EmptyState>
				</div>
			</div>
		</section>
	{/if}
</div>

{#if tab === 'components'}
	<!-- Database table uses the wide layout -->
	<section class="page-wide section" id="table">
		<h2>Database table</h2>
		<div class="table-toolbar">
			<Tabs
				bind:active={viewTab}
				label="People views"
				tabs={[
					{ id: 'all', label: 'All people', icon: 'list', count: 26 },
					{ id: 'attention', label: 'Needs attention', icon: 'alert', count: 3 },
					{ id: 'disabled', label: 'Disabled', icon: 'lock' }
				]}
			/>
			<div class="toolbar-actions">
				<IconButton icon="filter" label="Filter" size="sm" />
				<IconButton icon="search" label="Search" size="sm" />
				<Button size="sm" variant="primary" icon="plus">New</Button>
			</div>
		</div>
		{#if selected.length}
			<div class="bulk">
				<span class="bulk-count">{selected.length} selected</span>
				<Button size="sm" variant="ghost" icon="sync">Push</Button>
				<Button size="sm" variant="ghost" icon="refresh">Check</Button>
				<Button size="sm" variant="ghost" icon="tag">Tag</Button>
			</div>
		{/if}
		<Table
			{columns}
			rows={people}
			rowKey={(r) => r.id}
			selectable
			bind:selected
			rowHref={(r) => `#${r.id}`}
		>
			{#snippet cell(row, col)}
				{#if col.key === 'name'}
					<Icon name="person" size={16} class="row-ic" />{row.name}
				{:else if col.key === 'tags'}
					<span class="tags">
						{#each row.tags as t (t)}<Tag size="sm" color={tagColorFor(t)} label={t} />{/each}
					</span>
				{:else if col.key === 'status'}
					<StatusTag status={row.status} size="sm" />
				{:else if col.key === 'streams' || col.key === 'metadata'}
					{#if row[col.key]}{row[col.key]}{:else}<span class="faint">Not bound</span>{/if}
				{:else if col.key === 'updated'}
					<span class="muted">{row.updated}</span>
				{/if}
			{/snippet}
			{#snippet footer()}
				<span>Count</span><strong class="count">{people.length}</strong>
			{/snippet}
		</Table>

		<h3 class="sub">Empty table</h3>
		<Table columns={columns.slice(0, 3)} rows={[]}>
			{#snippet empty()}
				<EmptyState
					compact
					icon="search"
					title="No matches"
					description="Try a different search."
				/>
			{/snippet}
		</Table>
	</section>

	<div class="page">
		<!-- Editing -->
		<section class="section" id="editing">
			<h2>Code and JSON</h2>
			<div class="stack" style:--stack-gap="20px">
				<CodeEditor label="Template body" bind:value={code} bind:valid={editorValid} name="body" />
				<p class="small muted">Bound state: {editorValid ? 'valid' : 'invalid'}</p>
				<CodeEditor label="Invalid example" bind:value={badCode} minLines={4} />
				<div>
					<p class="label">Rendered preview (secrets masked)</p>
					<JsonView value={sample} expandDepth={3} />
				</div>
			</div>
		</section>

		<!-- Overlays -->
		<section class="section" id="overlays">
			<h2>Overlays and feedback</h2>
			<div class="demo">
				<div class="row">
					<Button onclick={() => (modalOpen = true)}>Open modal</Button>
					<Button variant="danger" onclick={() => (dangerOpen = true)}>Delete person</Button>
					<Button onclick={() => toast('Queued 4 push jobs')}>Toast</Button>
					<Button onclick={() => toast.success('Pushed Sam / AIOStreams')}>Success toast</Button>
					<Button
						onclick={() =>
							toast.error('Upstream returned 502', {
								action: { label: 'Retry', onclick: () => toast('Retrying') }
							})}>Error toast</Button
					>
				</div>
				<div class="row">
					<Menu
						label="Row actions"
						items={[
							{ heading: 'Person' },
							{ label: 'Open', icon: 'arrow-right' },
							{ label: 'Share page', icon: 'share', hint: 'S' },
							{ label: 'Copy id', icon: 'copy' },
							{ divider: true },
							{ label: 'Push', icon: 'sync' },
							{ label: 'Rotate', icon: 'rotate', disabled: true },
							{ divider: true },
							{ label: 'Revoke access', icon: 'lock', danger: true }
						]}
					/>
					<Menu
						align="start"
						items={[{ label: 'Latest', checked: true }, { label: 'v6' }, { label: 'v5' }]}
					>
						{#snippet trigger(props)}
							<button type="button" class="custom-trigger" {...props}>
								Version: Latest <Icon name="chevron-down" size={14} />
							</button>
						{/snippet}
					</Menu>
					<Tooltip text="Push all pending" shortcut="Ctrl+P">
						<IconButton icon="sync" label="Push all pending" />
					</Tooltip>
					<Tooltip text="Below" placement="bottom"><Button size="sm">Hover me</Button></Tooltip>
					<Spinner />
					<Spinner size={20} label="Loading" />
					<span class="small muted">Press <Kbd>Ctrl</Kbd> <Kbd>\</Kbd> to toggle the sidebar</span>
				</div>
				<div class="stack" style:max-width="420px">
					<ProgressBar value={0.62} label="Pushing 8 of 13" showValue />
					<ProgressBar value={1} color="green" />
					<ProgressBar label="Validating addons" />
				</div>
			</div>
		</section>

		<!-- Navigation -->
		<section class="section" id="nav">
			<h2>Navigation</h2>
			<div class="demo">
				<Breadcrumbs
					items={[
						{ label: 'People', href: '/people', icon: 'people' },
						{ label: 'Sam', href: '#nav' },
						{ label: 'AIOStreams' }
					]}
				/>
				<div class="row" style:align-items="flex-start" style:gap="24px">
					<QrCode svg={qrSvg} size={140} label="Example QR code" />
					<div class="stack" style:--stack-gap="8px">
						<p class="small">
							QR codes always render dark on white so phones can scan them in dark mode.
						</p>
						<div class="row">
							<Button variant="primary" icon="external-link" size="sm">Install in Stremio</Button>
							<CopyButton
								value="https://example.com/manifest.json"
								label="Copy manifest URL"
								size="sm"
							/>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- Icons -->
		<section class="section" id="icons">
			<h2>Icons</h2>
			<p class="lead">
				Line icons on a 20px grid, stroke 1.5. Use <code>&lt;Icon name="..." /&gt;</code>.
			</p>
			<div class="icons">
				{#each icons as name (name)}
					<div class="icon-cell" title={name}>
						<Icon {name} size={20} />
						<span>{name}</span>
					</div>
				{/each}
			</div>
		</section>
	</div>
{/if}

<Modal
	bind:open={modalOpen}
	title="Add person"
	description="People get their own configs, share page and secrets."
>
	<div class="stack" style:--stack-gap="14px">
		<Input label="Display name" placeholder="e.g. Grandma" />
		<Select
			label="AIOStreams template"
			placeholder="None"
			options={['Family', 'Anime fan']}
			value=""
		/>
		<Textarea label="Notes" rows={2} />
	</div>
	{#snippet footer()}
		<Button onclick={() => (modalOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			onclick={() => {
				modalOpen = false;
				toast.success('Person added');
			}}>Add person</Button
		>
	{/snippet}
</Modal>

<Modal
	bind:open={dangerOpen}
	size="sm"
	title="Delete Uncle Joe?"
	description="Their bindings, secrets and share links are removed."
>
	<Checkbox label="Also delete the upstream configs" />
	{#snippet footer()}
		<Button onclick={() => (dangerOpen = false)}>Cancel</Button>
		<Button variant="danger" onclick={() => (dangerOpen = false)}>Delete</Button>
	{/snippet}
</Modal>

<style>
	.section {
		padding-top: 40px;
		scroll-margin-top: 56px;
	}
	.section > h2 {
		margin-bottom: 4px;
	}
	.lead {
		margin-bottom: 16px;
		color: var(--text-secondary);
		font-size: 14px;
	}
	.section > h2 + .demo,
	.section > h2 + .stack,
	.section > h2 + .table-toolbar {
		margin-top: 16px;
	}
	.sub {
		margin: 32px 0 8px;
	}
	.small {
		font-size: 14px;
	}
	.label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
		margin-bottom: 4px;
	}
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		padding: 16px 0 0;
		font-size: 14px;
	}
	.toc a {
		color: var(--text-secondary);
		text-decoration: none;
	}
	.toc a:hover {
		color: var(--text);
	}
	.demo {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px 24px;
	}
	.grid2 .full {
		grid-column: 1 / -1;
	}
	.type-scale {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 20px 0;
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
	}
	.swatch {
		display: grid;
		grid-template-columns: 28px 1fr;
		grid-template-rows: auto auto;
		column-gap: 10px;
		align-items: center;
		font-size: 13px;
	}
	.chip {
		grid-row: span 2;
		width: 28px;
		height: 28px;
		border-radius: var(--radius);
		box-shadow: inset 0 0 0 1px var(--border-input);
	}
	.sw-var {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-tertiary);
	}
	.bordered {
		border-radius: var(--radius-lg);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.avatar-sm {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--tag-gray-bg);
		color: var(--tag-gray-text);
		font-size: 11px;
		font-weight: 600;
	}
	.table-toolbar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		border-bottom: 1px solid var(--divider);
		margin-bottom: 4px;
	}
	.table-toolbar :global(.tabs) {
		border-bottom: 0;
	}
	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-bottom: 4px;
	}
	.bulk {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 36px;
		font-size: 14px;
	}
	.bulk-count {
		padding: 0 8px;
		color: var(--accent-text);
		font-weight: 500;
	}
	.tags {
		display: inline-flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.tags:empty::after {
		content: '';
	}
	:global(.row-ic) {
		color: var(--text-secondary);
		margin-right: 2px;
	}
	.count {
		color: var(--text-secondary);
		font-weight: 500;
	}
	.custom-trigger {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 8px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font-size: 14px;
	}
	.custom-trigger:hover {
		background: var(--bg-hover);
	}
	.icons {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 4px;
	}
	.icon-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 12px 4px 8px;
		border-radius: var(--radius);
		color: var(--text);
		font-size: 11px;
	}
	.icon-cell span {
		color: var(--text-tertiary);
		font-family: var(--font-mono);
		text-align: center;
		word-break: break-all;
	}
	.icon-cell:hover {
		background: var(--bg-hover);
	}
	@media (max-width: 768px) {
		.grid2 {
			grid-template-columns: 1fr;
		}
		.table-toolbar {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
