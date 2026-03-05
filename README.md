# SYN100 Game

SYN100 is a narrative decision game where the player answers 10 alien protocol questions that determine Earth’s fate.

Each answer changes a hidden Communication Score from -10 to +10. Choices that show empathy, adaptability, and non-human perspective-taking increase the score, while human-centered or dominant framing lowers it.

At the end, the game reveals whether Earth is spared or destroyed, then generates a structured AI analysis that explains each question’s impact and gives an overall outcome summary.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS

## Backend (Vercel Python serverless)

OpenAI requests are proxied through server-side Python handlers in `api/`, so your key is never exposed in the browser.

### Vercel environment variable

In your Vercel project settings, add:

- `OPENAI_API_KEY` = your OpenAI API key

Set it for at least `Production` (and `Preview` if needed), then redeploy.

### Deploy

- Connect the repo to Vercel.
- Keep frontend calls as `/api/openai/chat-completions` and `/api/openai/audio-speech`.
- Vercel rewrites these to Python handlers via `vercel.json`.

### Local dev (optional)

You can still run local dev with Vite:

```bash
npm install
npm run dev
```
