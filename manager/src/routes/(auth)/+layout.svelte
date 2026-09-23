<script lang="ts">
	import { resolve } from '$app/paths';
	let { children } = $props();
</script>

<div class="auth">
	<header class="top">
		<a class="brand" href={resolve('/login')}>
			<span class="mark" aria-hidden="true">A</span>
			<span>AIO Manager</span>
		</a>
	</header>
	<main class="center">
		<div class="card">
			{@render children()}
		</div>
	</main>
	<footer class="foot">Self-hosted. Sessions and secrets stay on this server.</footer>
</div>

<style>
	.auth {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: var(--bg);
	}
	.top {
		display: flex;
		align-items: center;
		height: 64px;
		padding: 0 24px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 600;
		color: var(--text);
		text-decoration: none;
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: var(--radius);
		background: var(--text);
		color: var(--bg);
		font-size: 13px;
		font-weight: 700;
	}
	.center {
		flex: 1;
		display: flex;
		justify-content: center;
		padding: 8vh 16px 48px;
	}
	.card {
		width: 100%;
		max-width: 360px;
	}
	.foot {
		padding: 24px;
		text-align: center;
		font-size: 12px;
		color: var(--text-tertiary);
	}
	/* Shared auth page pieces (used by the (auth) pages). */
	.card :global(.auth-title) {
		font-size: 22px;
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: -0.005em;
	}
	.card :global(.auth-sub) {
		margin-top: 6px;
		font-size: 14px;
		color: var(--text-secondary);
	}
	.card :global(.auth-head) {
		margin-bottom: 28px;
	}
	.card :global(.auth-form) {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.card :global(.auth-foot) {
		margin-top: 24px;
		font-size: 12px;
		color: var(--text-tertiary);
		line-height: 1.5;
	}
	@media (max-width: 520px) {
		.center {
			padding-top: 4vh;
		}
		.top {
			padding: 0 16px;
		}
	}
</style>
