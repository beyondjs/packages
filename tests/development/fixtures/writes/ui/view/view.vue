<script setup lang="ts">
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
	<button class="counter" @click="count++">Count: {{ count }}</button>
</template>

<style scoped>
.counter {
	color: rgb(202, 138, 4);
}
</style>
