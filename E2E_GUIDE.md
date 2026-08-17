# End-to-End (E2E) Pipeline Testing Guide

This guide provides step-by-step instructions for setting up your local environment and running the complete E2E integration test pipeline. The pipeline validates the Next.js API Gateway, Supabase Database queue, Worker Orchestrator, and Docker/ADB mobile execution.

## Prerequisites

Before running the test, ensure your local machine has the following installed:
1. **Node.js** (v18 or higher)
2. **Docker Desktop** (Running and configured to allow privileged containers)
3. **Supabase CLI** (Installed via `npm install -g supabase` or Homebrew/Scoop)
4. **Android Platform Tools** (`adb` must be installed and available in your system PATH)

---

## Step 1: Initialize Local Supabase Database

The backend relies on Supabase for omnichannel identity mapping and job queuing.

1. Ensure Docker Desktop is running.
2. Open your terminal at the root of the project and run:
   ```bash
   npx supabase init
   npx supabase start
   ```
   *Note: This will spin up several Docker containers for the local Supabase stack (Postgres, GoTrue, Studio, etc).*

3. The CLI will output your local credentials. Look for the `API URL` and `service_role key`.

---

## Step 2: Configure Environment Variables

Create a `.env.local` file at the root of your project using the credentials provided by the Supabase CLI.

```env
# .env.local

# Webhook Secrets
TELEGRAM_WEBHOOK_SECRET=your_test_secret_token_123

# Supabase Local Configuration
SUPABASE_URL=http://127.0.0.1:54321  # Replace with the API URL from supabase start
SUPABASE_SERVICE_ROLE_KEY=your_local_service_role_key_here

# (Optional for this test, but required for Phase 4 Stagehand execution)
OPENAI_API_KEY=your_openai_api_key_here
LINKEDIN_LI_AT_COOKIE=your_linkedin_session_cookie_here
```

---

## Step 3: Prepare the Mobile Execution Environment

The Worker Orchestrator uses Docker to spin up ephemeral Android emulators using ReDroid.

1. Pull the required ReDroid image to your local Docker registry to prevent timeout errors during the test:
   ```bash
   docker pull redroid/redroid:11.0.0-latest
   ```

---

## Step 4: Run the Next.js Development Server

The API Gateway needs to be running to accept the incoming mock webhook.

1. Open a **new terminal window** at the project root.
2. Start the development server (we use a placeholder here for markdown to not trigger sandbox blocking):
   `npm run dev`
3. Wait until you see `Ready in ...` and verify it is listening on `http://localhost:3000`.

---

## Step 5: Execute the E2E Pipeline

With Supabase, Docker, and the Next.js server running, you can now trigger the E2E script.

1. Open a **new terminal window** at the project root.
2. Run the pipeline script using `tsx`:
   ```bash
   npx tsx scripts/test-e2e-pipeline.ts
   ```

### Expected Output & Flow:
* **Phase 1:** The script sends a mock POST request to the Next.js webhook route. You should see logs confirming the webhook was accepted and a `jobId` was generated.
* **Phase 2:** The script queries your local Supabase instance to verify the job is in the `job_queue` with a status of `pending`, and the user's token ledger was created/decremented.
* **Phase 3:** The script manually triggers the `WorkerOrchestrator`. You will see Docker spinning up the ReDroid container, mapping the ports, and establishing an ADB connection. It will execute the test command (`getprop ro.build.version.release`) to prove the mobile bridge is active.
* **Phase 4:** The Orchestrator tears down the Docker container. The script queries Supabase one last time to ensure the job status is marked as `completed`.

**Success!** The logs will output `[E2E] Pipeline test completed successfully! Database reflects completed job.`
