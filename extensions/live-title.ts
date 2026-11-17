/**
 * pi-live-title: keeps the session name (and so the terminal tab title,
 * which pi renders as `pi - <name> - <cwd>`) in sync with what the session
 * is about, using a short LLM summary.
 */

import type { Api, Model, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "live-title";
const USAGE_ENTRY_TYPE = "live-title-usage";
const DEFAULT_EVERY = 5;
const MAX_WORDS = 6;
const MAX_TITLE_CHARS = 48;
const MAX_PROMPTS = 12;
const MAX_PROMPT_CHARS = 400;
const MAX_ASSISTANT_CHARS = 600;

const SYSTEM_PROMPT = `You name coding-agent sessions. Given the user's recent requests, output a short title (2-${MAX_WORDS} words, lowercase, no quotes, no trailing punctuation) describing the overall task, e.g. "fix license scan ci" or "maintenance: notes, dotfiles".
If a current title is given and still fits, output it unchanged. Only change it when the topic has clearly shifted.
Output only the title.`;

interface Config {
	enabled: boolean;
	every: number;
	model?: string;
}

interface UsageEntryData {
	model: string;
	input: number;
	output: number;
	cost: number;
}

interface TitleEntryData {
	name: string;
	locked?: boolean;
}

function readConfig(pi: ExtensionAPI): Config {
	const raw = ((pi.getSettings() as Record<string, unknown>).liveTitle ?? {}) as Partial<Config>;
	const every = Number(raw.every);
	return {
		enabled: raw.enabled !== false,
		every: Number.isFinite(every) && every >= 1 ? Math.floor(every) : DEFAULT_EVERY,
		model: typeof raw.model === "string" && raw.model.includes("/") ? raw.model : undefined,
	};
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((c): c is { type: "text"; text: string } => c?.type === "text" && typeof c.text === "string")
		.map((c) => c.text)
		.join("\n");
}

function clip(s: string, n: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > n ? `${t.slice(0, n)}...` : t;
}

export function cleanTitle(raw: string): string | undefined {
	let t = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
	t = t.replace(/^title:\s*/i, "").replace(/^["'`*]+|["'`*.]+$/g, "").trim();
	const words = t.split(/\s+/).filter(Boolean);
	if (words.length === 0) return undefined;
	t = words.slice(0, MAX_WORDS).join(" ");
	if (t.length > MAX_TITLE_CHARS) t = `${t.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
	return t;
}

export default function (pi: ExtensionAPI) {
	let promptsSinceTitle = 0;
	let hasAutoTitle = false;
	let locked = false;
	let inFlight = false;
	let ourName: string | undefined;
	let stats = { calls: 0, input: 0, output: 0, cost: 0 };

	function restore(ctx: ExtensionContext) {
		promptsSinceTitle = 0;
		inFlight = false;
		ourName = undefined;
		stats = { calls: 0, input: 0, output: 0, cost: 0 };
		let last: TitleEntryData | undefined;
		for (const e of ctx.sessionManager.getEntries()) {
			if (e.type !== "custom") continue;
			const { customType, data } = e as { customType?: string; data?: unknown };
			if (customType === ENTRY_TYPE) last = data as TitleEntryData;
			if (customType === USAGE_ENTRY_TYPE && data) addStats(data as UsageEntryData);
		}
		const current = ctx.sessionManager.getSessionName();
		hasAutoTitle = !!last && !last.locked && last.name === current;
		// A name we didn't set (e.g. via /name or --name) is the user's choice.
		locked = !!current && !hasAutoTitle ? true : !!last?.locked;
		if (hasAutoTitle) ourName = current;
	}

	function resolveModel(ctx: ExtensionContext, cfg: Config): Model<Api> | undefined {
		if (cfg.model) {
			const i = cfg.model.indexOf("/");
			const m = ctx.modelRegistry.find(cfg.model.slice(0, i), cfg.model.slice(i + 1));
			if (m) return m;
		}
		return ctx.model;
	}

	function collectContext(ctx: ExtensionContext): { prompts: string[]; lastAssistant: string } {
		const prompts: string[] = [];
		let lastAssistant = "";
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type !== "message") continue;
			const msg = (e as { message: { role: string; content: unknown } }).message;
			if (msg.role === "user") {
				const t = clip(textOf(msg.content), MAX_PROMPT_CHARS);
				if (t) prompts.push(t);
			} else if (msg.role === "assistant") {
				const t = textOf(msg.content);
				if (t.trim()) lastAssistant = t;
			}
		}
		return { prompts: prompts.slice(-MAX_PROMPTS), lastAssistant: clip(lastAssistant, MAX_ASSISTANT_CHARS) };
	}

	async function generate(ctx: ExtensionContext, cfg: Config, signal?: AbortSignal): Promise<string | undefined> {
		const model = resolveModel(ctx, cfg);
		if (!model) return undefined;
		const { prompts, lastAssistant } = collectContext(ctx);
		if (prompts.length === 0) return undefined;
		const current = ctx.sessionManager.getSessionName();
		const body = [
			current ? `Current title: ${current}` : "Current title: (none)",
			`Working directory: ${ctx.cwd}`,
			"Recent user requests (oldest first):",
			...prompts.map((p, i) => `${i + 1}. ${p}`),
			lastAssistant ? `Latest assistant reply (excerpt): ${lastAssistant}` : "",
		]
			.filter(Boolean)
			.join("\n");
		const message: UserMessage = { role: "user", content: [{ type: "text", text: body }], timestamp: Date.now() };
		const stream = ctx.modelRegistry.streamSimple(
			model,
			{ systemPrompt: SYSTEM_PROMPT, messages: [message] },
			{ maxTokens: 64, signal },
		);
		const result = await stream.result();
		if (result.usage) {
			const u: UsageEntryData = {
				model: `${model.provider}/${model.id}`,
				input: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
				output: result.usage.output,
				cost: result.usage.cost?.total ?? 0,
			};
			addStats(u);
			pi.appendEntry<UsageEntryData>(USAGE_ENTRY_TYPE, u);
		}
		if (result.stopReason === "error" || result.stopReason === "aborted") return undefined;
		return cleanTitle(textOf(result.content));
	}

	function addStats(u: UsageEntryData) {
		stats.calls++;
		stats.input += u.input || 0;
		stats.output += u.output || 0;
		stats.cost += u.cost || 0;
	}

	function apply(name: string, lock: boolean) {
		ourName = name;
		pi.setSessionName(name);
		pi.appendEntry<TitleEntryData>(ENTRY_TYPE, { name, locked: lock || undefined });
	}

	async function refresh(ctx: ExtensionContext, cfg: Config) {
		if (inFlight) return;
		inFlight = true;
		try {
			const title = await generate(ctx, cfg);
			if (!title || locked) return;
			promptsSinceTitle = 0;
			hasAutoTitle = true;
			if (title !== ctx.sessionManager.getSessionName()) apply(title, false);
		} catch {
			// Titles are best-effort; never surface errors into the session.
		} finally {
			inFlight = false;
		}
	}

	pi.on("session_start", async (_event, ctx) => restore(ctx));

	pi.on("session_info_changed", async (_event, ctx) => {
		const name = ctx.sessionManager.getSessionName();
		if (name && name !== ourName) {
			locked = true;
			hasAutoTitle = false;
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (event.messageType === "user") promptsSinceTitle++;
	});

	pi.on("agent_settled", async (event, ctx) => {
		if (!ctx.hasUI || event.aborted || locked) return;
		const cfg = readConfig(pi);
		if (!cfg.enabled) return;
		if (hasAutoTitle && promptsSinceTitle < cfg.every) return;
		void refresh(ctx, cfg);
	});

	pi.registerCommand("title", {
		description: "Session title: /title (regenerate), /title <text> (set and lock), /title auto (unlock), /title stats (token cost)",
		handler: async (args, ctx) => {
			const arg = args.trim();
			if (arg === "stats") {
				const avg = stats.calls ? Math.round(stats.input / stats.calls) : 0;
				ctx.ui.notify(
					`Session title: ${stats.calls} calls, ${stats.input} in / ${stats.output} out tokens (avg ${avg} in), $${stats.cost.toFixed(4)}`,
					"info",
				);
				return;
			}
			if (arg === "auto") {
				locked = false;
				hasAutoTitle = false;
				const current = ctx.sessionManager.getSessionName();
				// Persist the unlock even if the regenerated title ends up unchanged.
				if (current) apply(current, false);
				ctx.ui.notify("Session title: automatic", "info");
				await refresh(ctx, readConfig(pi));
				return;
			}
			if (arg) {
				const name = cleanTitle(arg) ?? arg;
				locked = true;
				hasAutoTitle = false;
				apply(name, true);
				ctx.ui.notify(`Session title locked: ${name}`, "info");
				return;
			}
			locked = false;
			await refresh(ctx, readConfig(pi));
			const name = ctx.sessionManager.getSessionName();
			ctx.ui.notify(name ? `Session title: ${name}` : "Could not generate a title", name ? "info" : "warning");
		},
	});
}
