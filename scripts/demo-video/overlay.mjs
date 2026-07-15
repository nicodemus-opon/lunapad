// In-page "director" overlay: animated cursor, click ripples, keycap flashes, and
// kinetic (not flat-fade) captions/title cards/feature cards/end card. Installed via
// page.addInitScript so every navigation/reload in a chapter recording re-paints it —
// this app's dev server does occasional HMR/full reloads that silently wipe
// directly-appended body children (outside Svelte's tracked tree), so every accessor
// below looks its element up fresh by id and recreates it on demand rather than
// caching a reference in a closure.
export async function installOverlay(page) {
	await page.addInitScript(() => {
		function ensureStyle() {
			if (document.getElementById('__demo-style')) return;
			const style = document.createElement('style');
			style.id = '__demo-style';
			style.textContent = `
				#__demo-cursor { position: fixed; z-index: 999999; width: 22px; height: 22px; margin: -11px 0 0 -2px;
					pointer-events: none; transition: transform 60ms linear; will-change: transform; }
				#__demo-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.45)); }
				.__demo-ripple { position: fixed; z-index: 999998; width: 8px; height: 8px; border-radius: 50%;
					background: rgba(99,102,241,.55); pointer-events: none; transform: translate(-50%,-50%) scale(1);
					animation: __demo-ripple-anim 600ms ease-out forwards; }
				@keyframes __demo-ripple-anim { to { transform: translate(-50%,-50%) scale(6); opacity: 0; } }

				#__demo-caption { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); z-index: 999997;
					max-width: 70vw; padding: 12px 22px; border-radius: 12px; background: rgba(10,10,14,.88); color: #fff;
					font: 600 20px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing: -.01em;
					box-shadow: 0 16px 42px rgba(0,0,0,.32); text-align: center; white-space: normal; }
				#__demo-caption span { display: inline-block; opacity: 0; transform: translateY(14px) scale(.94); }
				#__demo-caption.show span { animation: __demo-word-in 420ms cubic-bezier(.16,1,.3,1) forwards; }
				@keyframes __demo-word-in { to { opacity: 1; transform: translateY(0) scale(1); } }

				#__demo-keys { position: fixed; left: 50%; bottom: 100px; z-index: 999997; transform: translate(-50%, 10px);
					display: flex; gap: 6px; opacity: 0; transition: opacity 200ms ease, transform 200ms ease; }
				#__demo-keys.show { opacity: 1; transform: translate(-50%, 0); }
				#__demo-keys span { background: rgba(20,20,24,.9); color: #fff; font: 700 13px/1 -apple-system,sans-serif;
					padding: 7px 11px; border-radius: 7px; box-shadow: 0 4px 12px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.08); }

				#__demo-title { position: fixed; inset: 0; z-index: 1000000; display: flex; align-items: center;
					justify-content: center; flex-direction: column; gap: 10px; background: linear-gradient(160deg,#0b0b0e 0%,#16161d 55%,#0b0b0e 100%);
					opacity: 0; pointer-events: none; transition: opacity 260ms ease; font-family: -apple-system,BlinkMacSystemFont,sans-serif; }
				#__demo-title.show { opacity: 1; }
				#__demo-title b { font-size: 52px; font-weight: 750; letter-spacing: -.03em; color: #fff;
					opacity: 0; transform: translateY(18px) scale(.92); transition: opacity 480ms cubic-bezier(.16,1,.3,1) 60ms, transform 480ms cubic-bezier(.16,1,.3,1) 60ms; }
				#__demo-title .t { margin-top: 4px; font-size: 24px; font-weight: 550; color: rgba(255,255,255,.88);
					opacity: 0; transform: translateY(14px); transition: opacity 420ms ease 220ms, transform 420ms ease 220ms; }
				#__demo-title .s { margin-top: 8px; font-size: 15px; color: rgba(255,255,255,.5);
					opacity: 0; transition: opacity 420ms ease 380ms; }
				#__demo-title.show b, #__demo-title.show .t { opacity: 1; transform: none; }
				#__demo-title.show .s { opacity: 1; }

				#__demo-feature { position: fixed; right: 44px; top: 92px; z-index: 999998; width: 400px;
					background: rgba(248,250,252,.97); color: #0f172a; border: 1px solid rgba(15,23,42,.1);
					border-radius: 16px; box-shadow: 0 24px 70px rgba(15,23,42,.3); padding: 22px; pointer-events: none;
					font-family: -apple-system,BlinkMacSystemFont,sans-serif;
					opacity: 0; transform: translate(24px, -6px) scale(.97);
					transition: opacity 340ms cubic-bezier(.16,1,.3,1), transform 340ms cubic-bezier(.16,1,.3,1); }
				#__demo-feature.show { opacity: 1; transform: none; }
				#__demo-feature h4 { margin: 0 0 10px; font-size: 20px; font-weight: 700; letter-spacing: -.02em; }
				#__demo-feature ul { margin: 0; padding-left: 18px; font-size: 14.5px; line-height: 1.55; }
			`;
			(document.head || document.documentElement).appendChild(style);
		}

		function ensureEl(id, build) {
			if (!document.body) return null;
			let el = document.getElementById(id);
			if (!el) {
				ensureStyle();
				el = document.createElement('div');
				el.id = id;
				if (build) build(el);
				document.body.appendChild(el);
			}
			return el;
		}

		window.__demoCaption = (text) => {
			const el = ensureEl('__demo-caption');
			if (!el) return;
			if (!text) {
				el.classList.remove('show');
				return;
			}
			el.classList.remove('show');
			el.innerHTML = text
				.split(' ')
				.map((word, i) => `<span style="animation-delay:${i * 34}ms">${word}</span>`)
				.join(' ');
			void el.offsetWidth; // restart the stagger animation on repeated captions
			el.classList.add('show');
		};

		window.__demoKeys = (labels) => {
			const el = ensureEl('__demo-keys');
			if (!el) return;
			if (!labels) {
				el.classList.remove('show');
				return;
			}
			el.innerHTML = labels.map((l) => `<span>${l}</span>`).join('');
			el.classList.add('show');
		};

		window.__demoTitle = (on, title, subtitle) => {
			const el = ensureEl('__demo-title', (e) => {
				e.innerHTML = `<b></b><div class="t"></div><div class="s"></div>`;
			});
			if (!el) return;
			if (on) {
				el.querySelector('b').textContent = title ?? 'Lunapad';
				el.querySelector('.t').textContent = subtitle ?? '';
			}
			el.classList.toggle('show', !!on);
		};

		window.__demoFeature = (on, title, lines) => {
			const el = ensureEl('__demo-feature', (e) => {
				e.innerHTML = `<h4></h4><ul></ul>`;
			});
			if (!el) return;
			if (on) {
				el.querySelector('h4').textContent = title ?? '';
				el.querySelector('ul').innerHTML = (lines ?? []).map((l) => `<li>${l}</li>`).join('');
			}
			el.classList.toggle('show', !!on);
		};

		window.addEventListener('mousemove', (e) => {
			const el = ensureEl('__demo-cursor', (c) => {
				c.innerHTML = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M2 1.5 L2 18.5 L6.5 14.5 L9.5 20.5 L12 19.3 L9 13.3 L15 13 Z" fill="white" stroke="black" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
			});
			if (el) el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
		});
		window.addEventListener('mousedown', (e) => {
			if (!document.body) return;
			ensureStyle();
			const r = document.createElement('div');
			r.className = '__demo-ripple';
			r.style.left = e.clientX + 'px';
			r.style.top = e.clientY + 'px';
			document.body.appendChild(r);
			setTimeout(() => r.remove(), 650);
		});
	});
}

// DEMO_VIDEO_SPEED scales every hold in this file — record.mjs sets it well below 1 in
// --smoke mode so a full beat list still round-trips in well under a minute.
const speedFactor = () => Number(process.env.DEMO_VIDEO_SPEED ?? '1');
export const pause = (page, ms) => page.waitForTimeout(Math.max(30, Math.round(ms * speedFactor())));

export const caption = (page, text) => page.evaluate((t) => window.__demoCaption(t), text);

export const titleCard = (page, title, subtitle) =>
	page.evaluate(({ title, subtitle }) => window.__demoTitle(true, title, subtitle), {
		title,
		subtitle
	});

export const hideTitleCard = (page) => page.evaluate(() => window.__demoTitle(false));

export const featureCard = (page, title, lines) =>
	page.evaluate(({ title, lines }) => window.__demoFeature(true, title, lines), { title, lines });

export const hideFeatureCard = (page) => page.evaluate(() => window.__demoFeature(false));

// Cells have Jupyter-style single-letter command-mode shortcuts (e.g. "b" = insert cell
// after) that key off e.key alone, ignoring modifiers — if a cell has focus, its handler
// preventDefault()s a ⌘-combo before the app's global shortcut handler ever sees it.
// Blur whatever's focused first so the global handler (sidebar/palette) gets it instead.
export const blurActive = (page) =>
	page.evaluate(() =>
		document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null
	);

export async function keyflash(page, labels, comboKeys) {
	await blurActive(page);
	await page.evaluate((l) => window.__demoKeys(l), labels);
	await pause(page, 260);
	await page.keyboard.press(comboKeys);
	await pause(page, 420);
	await page.evaluate(() => window.__demoKeys(null));
}

// Move the synthetic cursor smoothly to an element's center instead of teleporting.
export async function moveTo(page, locator, opts = {}) {
	const box = await locator.boundingBox();
	if (!box) return null;
	const x = box.x + (opts.dx ?? box.width / 2);
	const y = box.y + (opts.dy ?? box.height / 2);
	await page.mouse.move(x, y, { steps: 22 });
	return { x, y, width: box.width, height: box.height };
}

// A resting spot clear of any cell content, so a stationary cursor never ends up
// hovering an "add cell" divider or chart tooltip while the page scrolls underneath it.
export const PARK = { x: 1404, y: 64 };
export const park = (page) => page.mouse.move(PARK.x, PARK.y, { steps: 6 });
