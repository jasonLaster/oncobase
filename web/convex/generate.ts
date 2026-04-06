"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

const SYSTEM_PROMPT = `You are a research assistant for Diana's TNBC (triple-negative breast cancer) knowledge base. You help answer questions about Diana's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT: When citing information from a wiki or source page, use inline markdown links in the format [Page Title](/slug). For example: [Treatment Plan](/wiki/treatment-plan) or [Stanford Med Onc Notes](/sources/meeting-notes/319---stanford-med-onc). This lets the user click directly to the source. Use these inline citations throughout your response, not just at the end.

Key context:
- Patient: Diana Laster, age 36, diagnosed March 2026
- Diagnosis: Stage III TNBC, invasive ductal carcinoma, Grade 3
- Protocol: KEYNOTE-522 (Carboplatin + Paclitaxel + Pembrolizumab → AC)
- Care center: UCSF

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_wiki",
      description:
        "Search across all wiki pages and source documents for a keyword or phrase.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The search term" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_page",
      description: "Read the full content of a specific wiki page by its slug.",
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description: 'e.g. "wiki/treatment-plan"',
          },
        },
        required: ["slug"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_pages",
      description: "List all available wiki pages.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_pages_by_tag",
      description: "Find all pages that have a specific tag.",
      parameters: {
        type: "object",
        properties: { tag: { type: "string" } },
        required: ["tag"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tags",
      description: "List all tags used across the wiki.",
      parameters: { type: "object", properties: {} },
    },
  },
];

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export const generate = action({
  args: {
    conversationId: v.id("conversations"),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
      })
    ),
  },
  handler: async (ctx, { conversationId, messages }) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const appUrl = process.env.APP_URL;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
    if (!appUrl) throw new Error("APP_URL not set");

    // Mark streaming as active
    await ctx.runMutation(api.conversations.updateStreaming, {
      conversationId,
      text: "",
    });

    // Build message history for the API
    const apiMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    let accumulatedText = "";
    let lastFlush = 0;
    const uiParts: Array<Record<string, unknown>> = [];

    // Multi-step loop (up to 10 steps for tool calls)
    for (let step = 0; step < 10; step++) {
      const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "anthropic/claude-sonnet-4",
            messages: apiMessages,
            tools: TOOLS,
            stream: false,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        console.error("OpenRouter error:", err);
        break;
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      if (!choice) break;

      const msg = choice.message;

      // Handle tool calls
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Add the assistant message with tool calls to history
        apiMessages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls,
        });

        // Execute each tool call
        for (const tc of msg.tool_calls) {
          const toolName = tc.function.name;
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch {
            // ignore parse errors
          }

          // Record tool call in UI parts
          let toolOutput: unknown = null;
          try {
            const toolRes = await fetch(`${appUrl}/api/tools`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tool: toolName, args: toolArgs }),
            });
            toolOutput = await toolRes.json();
          } catch (e) {
            toolOutput = { error: String(e) };
          }

          uiParts.push({
            type: `tool-${toolName}`,
            toolName,
            toolCallId: tc.id,
            input: toolArgs,
            output: toolOutput,
            state: "output-available",
          });

          // Add tool result to message history
          apiMessages.push({
            role: "tool",
            content: JSON.stringify(toolOutput),
            tool_call_id: tc.id,
          });
        }

        // If the assistant also produced text alongside tool calls, accumulate it
        if (msg.content) {
          accumulatedText += msg.content;
          uiParts.push({ type: "text", text: msg.content });
        }

        // Flush streaming text
        const now = Date.now();
        if (now - lastFlush > 2000) {
          await ctx.runMutation(api.conversations.updateStreaming, {
            conversationId,
            text: accumulatedText || "Researching...",
          });
          lastFlush = now;
        }

        // Continue to next step (the model may produce more tool calls or final text)
        continue;
      }

      // No tool calls — this is the final text response
      if (msg.content) {
        accumulatedText += msg.content;
        uiParts.push({ type: "text", text: msg.content });

        // Flush partial text
        await ctx.runMutation(api.conversations.updateStreaming, {
          conversationId,
          text: accumulatedText,
        });
      }

      // finish_reason is "stop" or "end_turn" — we're done
      break;
    }

    // Save the final assistant message with parts
    if (accumulatedText || uiParts.length > 0) {
      await ctx.runMutation(api.conversations.saveMessages, {
        conversationId,
        messages: [
          {
            role: "assistant" as const,
            content: accumulatedText,
            parts: JSON.stringify(uiParts),
            createdAt: Date.now(),
          },
        ],
      });
    }

    // Clear streaming
    await ctx.runMutation(api.conversations.clearStreaming, {
      conversationId,
    });
  },
});
