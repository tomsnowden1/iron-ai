import process from "node:process";
import { handleCoachRequest } from "./_coachCore.js";

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (typeof body === "object") return body;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Method not allowed." } });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload) {
    res.status(400).json({ error: { message: "Invalid JSON body." } });
    return;
  }

  try {
    const result = await handleCoachRequest({
      payload,
      env: process.env,
    });
    res.status(result.status).json(result.body);
  } catch (err) {
    const message = String(err?.message ?? "").trim() || "Coach request failed.";
    res.status(500).json({ error: { message } });
  }
}
