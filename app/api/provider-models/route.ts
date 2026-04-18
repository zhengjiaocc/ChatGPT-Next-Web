import { NextRequest, NextResponse } from "next/server";
import { ServiceProvider } from "../../constant";

// Anthropic models endpoint
async function fetchAnthropicModels(apiKey: string, baseUrl: string) {
  const url = `${baseUrl}/v1/models`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m: { id: string }) => m.id) as string[];
}

// Google Gemini models endpoint
async function fetchGoogleModels(apiKey: string, baseUrl: string) {
  const url = `${baseUrl}/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google API error: ${res.status}`);
  const data = await res.json();
  return (data.models || [])
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((m: { name: string }) => m.name.replace("models/", "")) as string[];
}

// OpenAI-compatible models endpoint (OpenAI, DeepSeek, SiliconFlow, Moonshot, XAI, etc.)
async function fetchOpenAICompatibleModels(apiKey: string, baseUrl: string) {
  const url = `${baseUrl}/v1/models`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m: { id: string }) => m.id) as string[];
}

export async function POST(req: NextRequest) {
  try {
    const { type, apiKey, baseUrl } = await req.json();

    if (!apiKey) {
      return NextResponse.json({ error: "API key required" }, { status: 400 });
    }

    let models: string[] = [];

    if (type === ServiceProvider.Anthropic) {
      models = await fetchAnthropicModels(
        apiKey,
        baseUrl || "https://api.anthropic.com",
      );
    } else if (type === ServiceProvider.Google) {
      models = await fetchGoogleModels(
        apiKey,
        baseUrl || "https://generativelanguage.googleapis.com",
      );
    } else {
      // OpenAI-compatible
      models = await fetchOpenAICompatibleModels(apiKey, baseUrl);
    }

    return NextResponse.json({ models });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
