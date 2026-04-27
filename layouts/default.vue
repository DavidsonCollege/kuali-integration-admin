<template>
  <div class="min-h-screen flex flex-col">
    <header class="bg-ink text-white">
      <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <NuxtLink to="/" class="font-display font-bold text-xl tracking-wide text-white no-underline hover:no-underline">
          Kuali Integration Admin
        </NuxtLink>
        <nav class="flex items-center gap-4 text-sm">
          <span v-if="hasApiKey" class="text-white/70">
            {{ tenantHost }}
          </span>
          <button
            v-if="hasApiKey"
            class="text-white/70 underline-offset-2 hover:text-white hover:underline"
            @click="onDisconnect"
          >
            Disconnect
          </button>
        </nav>
      </div>
    </header>

    <main class="flex-1 max-w-6xl mx-auto w-full px-6 py-8">
      <slot />
    </main>

    <footer class="border-t border-rule mt-12 py-6">
      <div class="max-w-6xl mx-auto px-6 flex items-center justify-end text-sm text-subtle">
        <span class="font-display tracking-wide">Built on Kuali Build</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
const route = useRoute();
const { hasApiKey, baseUrl, clearApiKey } = useApiKey();

const tenantHost = computed(() => {
  try {
    return new URL(baseUrl.value).host;
  } catch {
    return baseUrl.value;
  }
});

// If the API key clears mid-session (e.g. useGraphQL detected a 401 and wiped
// it), bounce back to / so the connect form can show the auth-error message.
watch(hasApiKey, (val) => {
  if (!val && route.path !== '/') navigateTo('/');
});

const onDisconnect = () => {
  clearApiKey();
  navigateTo('/');
};
</script>
