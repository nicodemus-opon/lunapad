import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

// prqlc's error `hint` field is free text, not a structured suggestion — this
// only recognizes its most common phrasing ("did you mean `x`?") and offers no
// action at all if a hint doesn't match, rather than guessing.
const DID_YOU_MEAN_RE = /did you mean `([^`]+)`\??/i;

export function registerPrqlCodeActions(monaco: typeof Monaco): void {
	monaco.languages.registerCodeActionProvider('prql', {
		provideCodeActions(model, range, context) {
			const actions: Monaco.languages.CodeAction[] = [];
			for (const marker of context.markers) {
				const match = marker.message.match(DID_YOU_MEAN_RE);
				if (!match) continue;
				const suggestion = match[1];
				const editRange: Monaco.IRange = {
					startLineNumber: marker.startLineNumber,
					startColumn: marker.startColumn,
					endLineNumber: marker.endLineNumber,
					endColumn: marker.endColumn
				};
				actions.push({
					title: `Replace with '${suggestion}'`,
					kind: 'quickfix',
					diagnostics: [marker],
					isPreferred: true,
					edit: {
						edits: [
							{
								resource: model.uri,
								textEdit: { range: editRange, text: suggestion },
								versionId: undefined
							}
						]
					}
				});
			}
			return { actions, dispose: () => {} };
		}
	});
}
