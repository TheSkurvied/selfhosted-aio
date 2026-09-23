<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		text: string;
		/** Optional shortcut hint shown after the text in a lighter color. */
		shortcut?: string;
		placement?: 'top' | 'bottom';
		/** Delay before showing, ms. */
		delay?: number;
		children: Snippet;
	}

	let { text, shortcut, placement = 'top', delay = 350, children }: Props = $props();
	const uid = $props.id();
	let visible = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function show() {
		clearTimeout(timer);
		timer = setTimeout(() => (visible = true), delay);
	}
	function hide() {
		clearTimeout(timer);
		visible = false;
	}
</script>

<!-- The wrapper only listens for hover/focus of its content; the content stays the interactive element. -->
<span
	class="tt-wrap"
	role="presentation"
	onmouseenter={show}
	onmouseleave={hide}
	onfocusin={show}
	onfocusout={hide}
	onkeydown={(e) => e.key === 'Escape' && hide()}
	aria-describedby={visible ? `tt-${uid}` : undefined}
>
	{@render children()}
	{#if visible}
		<span class="tt {placement}" role="tooltip" id="tt-{uid}">
			{text}{#if shortcut}<span class="sc">{shortcut}</span>{/if}
		</span>
	{/if}
</span>

<style>
	.tt-wrap {
		position: relative;
		display: inline-flex;
	}
	.tt {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		padding: 4px 8px;
		border-radius: var(--radius);
		background: #0f0f0f;
		color: rgba(255, 255, 255, 0.9);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.4;
		white-space: nowrap;
		pointer-events: none;
		box-shadow: 0 1px 4px rgba(15, 15, 15, 0.2);
		animation: fade 100ms ease-out;
	}
	:global([data-theme='dark']) .tt {
		background: #373737;
	}
	.top {
		bottom: calc(100% + 6px);
	}
	.bottom {
		top: calc(100% + 6px);
	}
	.sc {
		margin-left: 6px;
		color: rgba(255, 255, 255, 0.5);
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
