// Inngest endpoint: the dev server and Inngest Cloud discover and invoke the workflow functions here.
import { serve } from "inngest/next";
import { inngest } from "@/workflows/client";
import { functions } from "@/workflows/functions";

// One step can be a deep-tier agent run; give each invocation room on Vercel.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
