<script lang="ts">
	let { attributes } = $props();
</script>

<p class="card svelte">{attributes.get('label')}</p>

<style>
	.card.svelte {
		color: rgb(147, 51, 234);
	}
</style>
