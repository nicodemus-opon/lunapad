import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

/**
 * Deliberate list keyboard behavior: Tab/Shift-Tab, Backspace at item start,
 * Enter on empty item exits the list.
 */
export const ListKeymapExtension = Extension.create({
	name: 'listKeymap',
	priority: 200,

	addKeyboardShortcuts() {
		return {
			Tab: () => {
				if (this.editor.commands.sinkListItem('taskItem')) return true;
				if (this.editor.commands.sinkListItem('listItem')) return true;
				return false;
			},
			'Shift-Tab': () => {
				if (this.editor.commands.liftListItem('taskItem')) return true;
				if (this.editor.commands.liftListItem('listItem')) return true;
				return false;
			},
			Backspace: () => {
				const { state } = this.editor;
				const { selection } = state;
				if (!selection.empty) return false;

				const { $from } = selection;
				if ($from.parentOffset !== 0) return false;

				const listItem =
					$from.node(-1)?.type.name === 'listItem' || $from.node(-1)?.type.name === 'taskItem'
						? $from.node(-1)
						: null;
				if (!listItem) return false;

				const listItemDepth = $from.depth - 1;
				const listItemPos = $from.before(listItemDepth);
				const isEmpty =
					listItem.textContent.length === 0 ||
					(listItem.childCount === 1 &&
						listItem.firstChild?.type.name === 'paragraph' &&
						listItem.firstChild.textContent.length === 0);

				if (isEmpty) {
					return this.editor.commands.liftListItem('taskItem') ||
						this.editor.commands.liftListItem('listItem') ||
						this.editor
							.chain()
							.command(({ tr }) => {
								const from = listItemPos;
								const to = listItemPos + listItem.nodeSize;
								tr.replaceWith(from, to, state.schema.nodes.paragraph.create());
								tr.setSelection(TextSelection.create(tr.doc, from + 1));
								return true;
							})
							.run();
				}

				return false;
			},
			Enter: () => {
				const { state } = this.editor;
				const { selection } = state;
				if (!selection.empty) return false;

				const { $from } = selection;
				const parent = $from.parent;
				if (parent.type.name !== 'paragraph') return false;

				const inTaskItem = $from.node(-1)?.type.name === 'taskItem';
				const inListItem = $from.node(-1)?.type.name === 'listItem';
				if (!inTaskItem && !inListItem) return false;

				const atEnd = $from.parentOffset === parent.content.size;
				const isEmpty = parent.textContent.length === 0;

				if (isEmpty && atEnd) {
					if (inTaskItem && this.editor.commands.liftListItem('taskItem')) return true;
					if (inListItem && this.editor.commands.liftListItem('listItem')) return true;
				}

				return false;
			}
		};
	}
});
