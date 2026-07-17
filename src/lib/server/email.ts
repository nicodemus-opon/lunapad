import net from 'node:net';
import tls from 'node:tls';

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

function smtpConfigured(): boolean {
	return Boolean(process.env.SMTP_HOST && process.env.EMAIL_FROM);
}

function escapeAddress(value: string): string {
	return value.replace(/[<>\r\n]/g, '').trim();
}

function smtpLineReader(socket: net.Socket | tls.TLSSocket) {
	let buffer = '';
	const waiters: Array<(line: string) => void> = [];
	socket.on('data', (chunk) => {
		buffer += chunk.toString('utf8');
		while (buffer.includes('\n') && waiters.length > 0) {
			const idx = buffer.indexOf('\n');
			const line = buffer.slice(0, idx + 1);
			buffer = buffer.slice(idx + 1);
			waiters.shift()?.(line);
		}
	});
	return () =>
		new Promise<string>((resolve) => {
			const idx = buffer.indexOf('\n');
			if (idx >= 0) {
				const line = buffer.slice(0, idx + 1);
				buffer = buffer.slice(idx + 1);
				resolve(line);
			} else {
				waiters.push(resolve);
			}
		});
}

async function readResponse(readLine: () => Promise<string>): Promise<string> {
	let response = '';
	for (;;) {
		const line = await readLine();
		response += line;
		if (/^\d{3} /.test(line)) return response;
	}
}

function assertSmtpOk(response: string, expected: number[]): void {
	const code = Number(response.slice(0, 3));
	if (!expected.includes(code)) throw new Error(`SMTP command failed: ${response.trim()}`);
}

function dotStuff(value: string): string {
	return value.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

export async function sendEmail(message: EmailMessage): Promise<{ delivery: 'email' | 'manual' }> {
	if (!smtpConfigured() || process.env.EMAIL_PROVIDER === 'manual' || process.env.EMAIL_PROVIDER === 'none') {
		return { delivery: 'manual' };
	}
	const host = process.env.SMTP_HOST!;
	const port = Number(process.env.SMTP_PORT ?? '587');
	const secure = process.env.SMTP_SECURE === 'true' || port === 465;
	const from = escapeAddress(process.env.EMAIL_FROM!);
	const to = escapeAddress(message.to);
	let socket: net.Socket | tls.TLSSocket = secure
		? tls.connect({ host, port, servername: host })
		: net.connect({ host, port });
	socket.setTimeout(15_000);
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('secureConnect', resolve);
			socket.once('error', reject);
			socket.once('timeout', () => reject(new Error('SMTP connection timed out.')));
		});
		let readLine = smtpLineReader(socket);
		const command = async (value: string, ok: number[]) => {
			socket.write(`${value}\r\n`);
			assertSmtpOk(await readResponse(readLine), ok);
		};
		assertSmtpOk(await readResponse(readLine), [220]);
		await command(`EHLO ${process.env.SMTP_HELO_HOST ?? 'lunapad.local'}`, [250]);
		if (!secure && process.env.SMTP_STARTTLS !== 'false') {
			await command('STARTTLS', [220]);
			socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
				const upgraded = tls.connect({ socket, servername: host }, () => resolve(upgraded));
				upgraded.once('error', reject);
			});
			readLine = smtpLineReader(socket);
			await command(`EHLO ${process.env.SMTP_HELO_HOST ?? 'lunapad.local'}`, [250]);
		}
		if (process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
			await command('AUTH LOGIN', [334]);
			await command(Buffer.from(process.env.SMTP_USER).toString('base64'), [334]);
			await command(Buffer.from(process.env.SMTP_PASSWORD).toString('base64'), [235]);
		}
		await command(`MAIL FROM:<${from}>`, [250]);
		await command(`RCPT TO:<${to}>`, [250, 251]);
		await command('DATA', [354]);
		const body = [
			`From: ${from}`,
			`To: ${to}`,
			`Subject: ${message.subject.replaceAll('\r', '').replaceAll('\n', ' ')}`,
			'MIME-Version: 1.0',
			'Content-Type: text/plain; charset=utf-8',
			'',
			message.text
		].join('\r\n');
		socket.write(`${dotStuff(body)}\r\n.\r\n`);
		assertSmtpOk(await readResponse(readLine), [250]);
		await command('QUIT', [221]);
		return { delivery: 'email' };
	} finally {
		socket.destroy();
	}
}

export async function checkEmailHealth(): Promise<'ok' | 'not_configured'> {
	if (!smtpConfigured()) return 'not_configured';
	return 'ok';
}
