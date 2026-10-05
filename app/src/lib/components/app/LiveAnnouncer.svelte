<script lang="ts">
  import { announcer } from '../../stores/announce.svelte';
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">{announcer.message}</div>
