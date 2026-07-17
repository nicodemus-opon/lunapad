<script lang="ts">
	import { Checkbox } from '$lib/components/ui/checkbox';

	interface Props {
		checked: boolean;
		ariaLabel: string;
		disabled?: boolean;
		onCheckedChange: (checked: boolean) => void;
	}

	const { checked, ariaLabel, disabled = false, onCheckedChange }: Props = $props();
</script>

<Checkbox
	class="md-task-checkbox"
	{checked}
	{disabled}
	aria-label={ariaLabel}
	onCheckedChange={(next) => onCheckedChange(Boolean(next))}
/>
