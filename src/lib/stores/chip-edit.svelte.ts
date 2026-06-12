// Tracks whether any chip input (GUI pipeline stage value) is being edited.
// Autorun defers while a chip is focused so half-typed values never execute.
// A counter (not a boolean) so chip→chip tabbing — where the next focus fires
// before the previous blur's delayed commit — stays balanced.

let activeChipEdits = $state(0);

export function beginChipEdit(): void {
	activeChipEdits += 1;
}

export function endChipEdit(): void {
	activeChipEdits = Math.max(0, activeChipEdits - 1);
}

export function isChipEditing(): boolean {
	return activeChipEdits > 0;
}
