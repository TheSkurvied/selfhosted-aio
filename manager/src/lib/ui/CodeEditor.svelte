<script lang="ts">
	import Icon from '$lib/icons/Icon.svelte';

	interface Props {
		value?: string;
		/** 'json' enables validation, the status line and Format. */
		language?: 'json' | 'text';
		/** Form field name; the textarea is submitted with the form. */
		name?: string;
		label?: string;
		placeholder?: string;
		readonly?: boolean;
		/** Minimum visible lines. */
		minLines?: number;
		/** Height cap in px; the editor scrolls beyond it. */
		maxHeight?: number;
		/** Bindable: whether `value` currently parses (always true for 'text'). */
		valid?: boolean;
		/** Extra error from the server (e.g. schema validation), shown in the status line. */
		error?: string | null;
		oninput?: (value: string) => void;
		id?: string;
	}

	let {
		value = $bindable(''),
		language = 'json',
		name,
		label,
		placeholder,
		readonly = false,
		minLines = 8,
		maxHeight = 560,
		valid = $bindable(true),
		error,
		oninput,
		id
	}: Props = $props();

	const uid = $props.id();
	const edId = $derived(id ?? `code-${uid}`);
	let ta: HTMLTextAreaElement | undefined = $state();
	let gutter: HTMLElement | undefined = $state();

	const LINE = 20;
	const PAD = 12;

	const lineCount = $derived(Math.max(1, value.split('\n').length));
	const visibleLines = $derived(Math.max(minLines, lineCount));
	const height = $derived(Math.min(maxHeight, visibleLines * LINE + PAD * 2));

	const parse = $derived.by((): { ok: boolean; message?: string; line?: number } => {
		if (language !== 'json') return { ok: true };
		if (value.trim() === '') return { ok: false, message: 'Empty' };
		try {
			JSON.parse(value);
			return { ok: true };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			const m = /position (\d+)/.exec(msg);
			const line = m ? value.slice(0, Number(m[1])).split('\n').length : undefined;
			const lm = /line (\d+)/.exec(msg);
			return { ok: false, message: msg.replace(/^JSON\.parse: /, ''), line: line ?? (lm ? Number(lm[1]) : undefined) };
		}
	});

	$effect(() => {
		valid = parse.ok;
	});

	function syncScroll() {
		if (gutter && ta) gutter.scrollTop = ta.scrollTop;
	}

	function insert(text: string, selStart: number, selEnd: number) {
		if (!ta) return;
		ta.setSelectionRange(selStart, selEnd);
		// execCommand keeps the browser undo stack; fall back to setRangeText.
		const ok = document.execCommand?.('insertText', false, text);
		if (!ok) {
			ta.setRangeText(text, selStart, selEnd, 'end');
			ta.dispatchEvent(new Event('input', { bubbles: true }));
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (!ta || readonly) return;
		if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			const { selectionStart: s, selectionEnd: en } = ta;
			const lineStart = value.lastIndexOf('\n', s - 1) + 1;
			if (e.shiftKey) {
				// Outdent the current line(s) by up to two spaces.
				const blockEnd = value.indexOf('\n', en);
				const end = blockEnd === -1 ? value.length : blockEnd;
				const block = value.slice(lineStart, end);
				const out = block.replace(/^ {1,2}/gm, '');
				if (out !== block) {
					insert(out, lineStart, end);
					ta.setSelectionRange(Math.max(lineStart, s - 2), Math.max(lineStart, en - (block.length - out.length)));
				}
			} else if (s !== en && value.slice(s, en).includes('\n')) {
				const block = value.slice(lineStart, en);
				const out = block.replace(/^/gm, '  ');
				insert(out, lineStart, en);
				ta.setSelectionRange(s + 2, en + (out.length - block.length));
			} else {
				insert('  ', s, en);
			}
		} else if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
			// Keep the current indentation, plus one level after { or [.
			const s = ta.selectionStart;
			const lineStart = value.lastIndexOf('\n', s - 1) + 1;
			const indent = /^[ \t]*/.exec(value.slice(lineStart, s))?.[0] ?? '';
			const prev = value.slice(0, s).trimEnd().slice(-1);
			const next = value.slice(ta.selectionEnd).trimStart()[0];
			const extra = prev === '{' || prev === '[' ? '  ' : '';
			e.preventDefault();
			if (extra && ((prev === '{' && next === '}') || (prev === '[' && next === ']'))) {
				insert('\n' + indent + extra + '\n' + indent, s, ta.selectionEnd);
				ta.setSelectionRange(s + 1 + indent.length + 2, s + 1 + indent.length + 2);
			} else {
				insert('\n' + indent + extra, s, ta.selectionEnd);
			}
		}
	}

	function format() {
		if (!parse.ok || !ta) return;
		const out = JSON.stringify(JSON.parse(value), null, 2);
		ta.focus();
		insert(out, 0, value.length);
	}

	function handleInput() {
		oninput?.(value);
	}
</script>

<div class="ce-field">
	{#if label}<label class="ce-label" for={edId}>{label}</label>{/if}
	<div class="ce" class:invalid={language === 'json' && (!parse.ok || !!error)} class:readonly>
		<div class="gutter" bind:this={gutter} aria-hidden="true" style:height="{height}px">
			<div class="nums" style:padding="{PAD}px 0">
				{#each { length: lineCount } as _, i (i)}
					<div class:err={parse.line === i + 1}>{i + 1}</div>
				{/each}
			</div>
		</div>
		<textarea
			bind:this={ta}
			bind:value
			id={edId}
			{name}
			{placeholder}
			{readonly}
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"
			wrap="off"
			style:height="{height}px"
			style:padding="{PAD}px 12px"
			aria-invalid={language === 'json' && !parse.ok ? 'true' : undefined}
			aria-describedby="{edId}-status"
			onscroll={syncScroll}
			{onkeydown}
			oninput={handleInput}
		></textarea>
	</div>
	{#if language === 'json'}
		<div class="status" id="{edId}-status" aria-live="polite">
			{#if error}
				<span class="bad"><Icon name="alert" size={14} />{error}</span>
			{:else if parse.ok}
				<span class="ok"><Icon name="check" size={14} />Valid JSON</span>
			{:else}
				<span class="bad">
					<Icon name="alert" size={14} />
					{parse.message}{#if parse.line}&nbsp;(line {parse.line}){/if}
				</span>
			{/if}
			<span class="meta">
				{lineCount} lines
				{#if !readonly}
					<button type="button" class="fmt" onclick={format} disabled={!parse.ok}>Format</button>
				{/if}
			</span>
		</div>
	{/if}
</div>

<style>
	.ce-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.ce-label {
		font-size: 12px;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.ce {
		display: flex;
		border-radius: var(--radius);
		background: var(--bg-code-block);
		box-shadow: inset 0 0 0 1px var(--border);
		overflow: hidden;
		transition: box-shadow var(--ease);
	}
	.ce:focus-within {
		box-shadow:
			inset 0 0 0 1px rgba(35, 131, 226, 0.57),
			var(--focus-ring);
	}
	.ce.invalid {
		box-shadow: inset 0 0 0 1px var(--danger-border);
	}
	.gutter {
		flex: none;
		overflow: hidden;
		min-width: 40px;
		border-right: 1px solid var(--divider);
		user-select: none;
	}
	.nums {
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 20px;
		text-align: right;
		padding-right: 8px !important;
		padding-left: 10px !important;
		color: var(--text-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.nums .err {
		color: var(--danger-text);
		font-weight: 600;
	}
	textarea {
		flex: 1;
		min-width: 0;
		display: block;
		border: 0;
		margin: 0;
		background: transparent;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 20px;
		tab-size: 2;
		white-space: pre;
		overflow: auto;
		resize: none;
	}
	textarea:focus,
	textarea:focus-visible {
		outline: none;
		box-shadow: none;
	}
	textarea::placeholder {
		color: var(--text-tertiary);
	}
	.readonly textarea {
		color: var(--text-secondary);
	}
	.status {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		min-height: 24px;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.status > span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.ok {
		color: var(--success-text);
	}
	.bad {
		color: var(--danger-text);
		overflow-wrap: anywhere;
	}
	.meta {
		flex: none;
		gap: 8px !important;
	}
	.fmt {
		height: 22px;
		padding: 0 6px;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text-secondary);
		font-size: 12px;
	}
	.fmt:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text);
	}
	.fmt:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
