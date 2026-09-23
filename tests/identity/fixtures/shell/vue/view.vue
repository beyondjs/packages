<script setup lang="ts">
import Kit from '@fixture/kit/vue';
import Panel from '@fixture/shell/panel';
</script>

<template>
	<div>
		<p class="title shell">shell</p>
		<Kit />
		<Panel />
	</div>
</template>

<style scoped>
.title {
	color: rgb(200, 0, 0);
}
</style>
