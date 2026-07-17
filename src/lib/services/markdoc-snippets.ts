// Markdoc widget boilerplates shared by the toolbar, slash palette, and catalog.
export const WIDGET_SNIPPETS = {
	callout: '{% callout type="info" %}\nAdd the note readers should see here.\n{% /callout %}',
	metric: '{% metric value=12 label="value" /%}',
	chart:
		'{% chart type="bar" data=[{"category":"current","value":12},{"category":"comparison","value":8}] x="category" y="value" /%}',
	datatable:
		'{% datatable data=[{"category":"current","value":12,"status":"active"},{"category":"comparison","value":8,"status":"pending"}] /%}',
	columns:
		'{% columns %}\n{% column %}\nAdd the first panel content here.\n{% /column %}\n{% column %}\nAdd the second panel content here.\n{% /column %}\n{% /columns %}',
	tabs: '{% tabs %}\n{% tab label="Overview" %}\nAdd overview content here.\n{% /tab %}\n{% /tabs %}',
	card: '{% card title="Section title" %}\nAdd supporting content here.\n{% /card %}',
	details: '{% details summary="Show details" %}\nAdd expanded content here.\n{% /details %}',
	filter:
		'{% filter kind="dropdown" param="status" label="status" options=["active","pending"] /%}',
	mermaid: '{% mermaid %}\ngraph TD\n    A --> B\n{% /mermaid %}',
	badge: '{% badge value="active" color="info" /%}',
	progress: '{% progress value=60 max=100 label="completion" /%}',
	grid: '{% grid cols=3 %}\nAdd grid content here.\n{% /grid %}',
	conditional:
		'{% if gt(1, 0) %}\nAdd conditional content here.\n{% else /%}\nAdd fallback content here.\n{% /if %}',
	pivotTable:
		'{% datatable data=[{"category":"current","status":"active","amount":12},{"category":"current","status":"pending","amount":8}] index=["category"] pivotBy="status" valueCol="amount" agg="sum" valueFormatKind="number" /%}',
	summaryTable:
		'{% datatable data=[{"category":"current","amount":12},{"category":"comparison","amount":8}] index=["category"] valueCol="amount" agg="sum" valueFormatKind="number" /%}',
	mermaidLoop:
		'{% mermaid %}\nkanban\n  {% group data=[{"status":"active","id":"item","title":"Review item"}] by="status" %}\n  $keyId[$key]\n    {% each data=$items %}\n    item_$id[$title]\n    {% /each %}\n  {% /group %}\n{% /mermaid %}',
	column: '{% column %}\nAdd column content here.\n{% /column %}',
	tab: '{% tab label="Overview" %}\nAdd tab content here.\n{% /tab %}',
	group:
		'{% group data=[{"category":"current","title":"Detail","value":12,"status":"active"}] by="category" %}\n{% card title=$key %}\n{% each data=$items %}\n{% card title=$title %}\n{% metric value=$value label="value" /%}\n{% badge value=$status /%}\n{% /card %}\n{% /each %}\n{% /card %}\n{% /group %}',
	each: '{% each data=[{"title":"Detail","value":12,"status":"active"}] %}\n{% card title=$title %}\n{% metric value=$value label="value" /%}\n{% badge value=$status /%}\n{% /card %}\n{% /each %}',
	else: '{% else /%}',
	video: '{% video src="https://" /%}',
	embed: '{% embed url="https://" /%}',
	bookmark: '{% bookmark url="https://" /%}',
	math: '{% math latex="E = mc^2" /%}',
	toc: '{% toc /%}'
} as const;
