# AIO Manager UI (Notion style)

Import everything from `$lib/ui`. Live examples of every component: `/styleguide`.

## Page chrome: breadcrumbs and top-bar actions

The `(app)` layout renders a 45px top bar: breadcrumbs on the left, page actions on the right.
Pages fill it with the `PageChrome` component (put it anywhere in the page, usually first):

```svelte
<script lang="ts">
	import { PageChrome, PageHeader, Button, Menu } from '$lib/ui';
	let { data } = $props();
</script>

<PageChrome
	title={data.person.displayName}
	crumbs={[
		{ label: 'People', href: '/people', icon: 'people' },
		{ label: data.person.displayName }
	]}
>
	{#snippet actions()}
		<Button size="sm" variant="ghost" icon="share">Share page</Button>
		<Menu
			items={[
				{ label: 'Delete', icon: 'trash', danger: true, onselect: () => (confirmOpen = true) }
			]}
		/>
	{/snippet}
</PageChrome>

<div class="page">
	<PageHeader title={data.person.displayName} icon="person" />
</div>
```

- `crumbs?: Crumb[]` (`{ label, href?, icon? }`). Omit it and the layout shows the matching nav
  section (e.g. "People") derived from the URL.
- `actions?: Snippet`. Use `size="sm"` buttons (ghost for secondary). On phones, buttons that have
  an icon collapse to icon-only and only the last crumb is shown.
- `title?: string` sets `<title>` as "`title` - AIO Manager".
- Everything is reactive and is cleared when the page unmounts.
- From script code, `usePageChrome({ crumbs: () => [...], actions: () => snippet })` does the
  same (call during component init).

## Layout classes (global, from `app.css`)

- `.page`: content column, max 900px, centered, 96px side padding (48px under 1080px, 16px on phones).
- `.page-wide`: full width with the same side padding. Use for tables.
- `.stack`, `.row`: flex column / wrapping row. Set `--stack-gap` / `--row-gap` to change the gap.
- `.muted`, `.faint`, `.mono`, `.sr-only`.

## Components

| Component                       | Key props                                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                        | `variant` default/primary/danger/ghost, `size` sm/md/lg, `icon`, `iconRight`, `loading`, `href`, `block`, plus any button attribute (`type`, `formaction`, `form`, `name`, `value`)                                                                                                   |
| `IconButton`                    | `icon`, `label` (required, aria-label + tooltip), `size`, `active`, `href`                                                                                                                                                                                                            |
| `Input` / `Textarea` / `Select` | `bind:value`, `label`, `hint`, `error`, `size`; Input: `icon`, `mono`, `bind:ref`; Select: `options` (strings or `{value,label}`), `placeholder`, `quiet`                                                                                                                             |
| `Checkbox` / `Toggle`           | `bind:checked`, `label`, `description`, `name`, `value`; Checkbox: `indeterminate`                                                                                                                                                                                                    |
| `Tag`                           | `color` (gray, brown, orange, yellow, green, blue, purple, pink, red, default), `label`, `dot`, `icon`, `onremove`; `tagColorFor(text)` gives a stable color for free-form tags                                                                                                       |
| `StatusTag`                     | `status: SyncStatus`, `title` (tooltip, e.g. last error)                                                                                                                                                                                                                              |
| `PageHeader`                    | `title`, `icon`, `description`, `meta` (e.g. a count), `actions` snippet, children (properties, tabs)                                                                                                                                                                                 |
| `PropertyList` + `Property`     | `label`, `icon`, `value` or children, `empty`, `mono`                                                                                                                                                                                                                                 |
| `Callout`                       | `color` gray/blue/yellow/red/green, `title`, `icon`, children, `actions` snippet                                                                                                                                                                                                      |
| `ToggleBlock`                   | `title` or `summary` snippet, `bind:open`, `heading`                                                                                                                                                                                                                                  |
| `Divider`                       | `label` ("or"), `space`                                                                                                                                                                                                                                                               |
| `EmptyState`                    | `title`, `description`, `icon`, `action` snippet, `compact`                                                                                                                                                                                                                           |
| `Table`                         | data mode: `columns: TableColumn[]`, `rows`, `rowKey`, `cell` snippet `(row, column)`, `rowHref`, `selectable` + `bind:selected` (keys), `empty`, `footer`; raw mode: pass your own `<thead>/<tbody>` as children                                                                     |
| `Tabs`                          | `tabs: TabItem[]` (`id, label, icon?, count?, href?`), `bind:active`, `onchange`, `panelPrefix`                                                                                                                                                                                       |
| `CodeEditor`                    | `bind:value`, `bind:valid`, `language` json/text, `name` (submits with forms), `label`, `error` (server message), `readonly`, `minLines`, `maxHeight`. Tab/Shift+Tab indent by two spaces; Format button                                                                              |
| `JsonView`                      | `value`, `expandDepth` (default 2), `maxHeight`. Strings starting with `••••` render in tertiary; `{{secret:name}}` placeholders are highlighted                                                                                                                                      |
| `Modal`                         | `bind:open`, `title`, `description`, `size` sm/md/lg, `onclose`, `dismissible`, children, `footer` snippet. Focus trap, Esc, focus restore                                                                                                                                            |
| `Menu`                          | `items: MenuEntry[]` (`{label, icon, onselect, href, submit, form, formaction, danger, disabled, hint, checked}`, `{divider:true}`, `{heading}`), `align` start/end, `label`, custom `trigger` snippet receiving props to spread on your button. Arrow keys, Home/End, typeahead, Esc |
| `toast()`                       | `toast('Saved')`, `toast.success(msg)`, `toast.error(msg, { action: { label, onclick } })`. The region is mounted in the root layout                                                                                                                                                  |
| `Tooltip`                       | `text`, `shortcut`, `placement`; wraps children                                                                                                                                                                                                                                       |
| `Spinner`, `ProgressBar`, `Kbd` | `size`/`label`; `value` 0..1 (omit for indeterminate), `label`, `showValue`, `color`                                                                                                                                                                                                  |
| `Breadcrumbs`                   | `items: Crumb[]`                                                                                                                                                                                                                                                                      |
| `Sidebar`, `SidebarItem`        | used by the app shell                                                                                                                                                                                                                                                                 |
| `CopyButton`                    | `value`, `label` (omit for icon-only), `copiedMessage`, `size`, `variant`                                                                                                                                                                                                             |
| `QrCode`                        | `svg` (server-rendered markup), `size`, `label`. Always dark on white                                                                                                                                                                                                                 |
| `Icon`                          | `name: IconName`, `size`, `strokeWidth`, `label`. Names are in `$lib/icons/paths.ts`                                                                                                                                                                                                  |

No emojis anywhere: use `Icon`.

## Forms

Use real `<form method="POST">` with `use:enhance`. For destructive actions in a `Menu`, either set
`submit: true, form: 'form-id', formaction: '?/delete'` on the entry (works without JS), or open a
`Modal` from `onselect` and put the form in it.

## Theme

`static/theme-init.js` applies the saved theme (`localStorage['aio-theme']`) and the collapsed
sidebar before first paint, so it works under the CSP. `theme.set('light' | 'dark' | 'system')`
from `$lib/ui` changes it at runtime.
