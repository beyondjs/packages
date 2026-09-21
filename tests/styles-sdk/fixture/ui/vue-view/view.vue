<script setup lang="ts">
import { ref } from 'vue';
const props = defineProps<{ label: string }>();
const count = ref(0);
const add = (): void => { count.value++; };
</script>

<template>
	<button class="counter" @click="add">{{ props.label }}: {{ count }}</button>
</template>

<style scoped>
.counter { color: rgb(30, 64, 175); }
</style>

<style>
.vue-global { display: inline; }
</style>
