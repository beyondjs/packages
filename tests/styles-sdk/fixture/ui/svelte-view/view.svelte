<script lang="ts">
	let { label }: { label: string } = $props();
	let count = $state(0);
</script>

<button class="counter" onclick={() => count++}>{label}: {count}</button>

<style>
	.counter { color: rgb(22, 101, 52); }
</style>
