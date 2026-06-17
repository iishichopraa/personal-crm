import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not set in Supabase Edge Function secrets" }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const { transcript, contacts = [] } = await req.json();
    if (!transcript || typeof transcript !== "string") {
      return new Response(JSON.stringify({ error: "transcript is required" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const contactNames = contacts.map((c: { name: string }) => c.name).join(", ");

    const prompt = `You analyze sales call transcripts for a CRM. Return ONLY valid JSON with this exact shape:
{
  "call_summary": "2-3 sentence overview of what the call was about",
  "priorities": [
    {
      "rank": 1,
      "person_name": "Full name of person to contact",
      "importance": "high",
      "topic": "Short label for the follow-up",
      "talk_about": "Detailed talking points — what to discuss with this person on the next call or meeting",
      "brief": "Brief context from the call about this person/topic",
      "action": "Specific recommended next step",
      "outreach_draft": "Optional ready-to-send email or LinkedIn message draft (2-4 sentences, friendly and professional)"
    }
  ]
}

Rules:
- importance must be "high", "medium", or "low"
- Sort priorities by importance (high first) then urgency
- Include everyone who needs a follow-up call, email, or meeting
- Match person_name to known CRM contacts when possible: ${contactNames || "none yet"}
- Include talk_about with specific discussion points for each person
- Include outreach_draft as a copy-paste ready message when appropriate; use empty string if not applicable

Transcript:
${transcript.slice(0, 120000)}`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `OpenAI error: ${errText}` }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return new Response(JSON.stringify({ error: "Empty AI response" }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.priorities)) {
      parsed.priorities = parsed.priorities.map((p: Record<string, unknown>, i: number) => {
        const name = String(p.person_name || "").toLowerCase();
        const match = contacts.find(
          (c: { id: string; name: string }) =>
            c.name.toLowerCase() === name ||
            c.name.toLowerCase().includes(name) ||
            name.includes(c.name.toLowerCase())
        );
        return { ...p, rank: p.rank ?? i + 1, contact_id: match?.id ?? null };
      });
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
