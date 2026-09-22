<script setup lang="ts">
defineProps<{ attributes: Map<string, string> }>();
</script>

<template>
	<p class="card vue">{{ attributes.get('label') }}</p>
</template>

<style>
.card.vue {
	color: rgb(22, 163, 74);
}
</style>
