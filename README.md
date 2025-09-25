# AI Bug Finder (Backend)

TypeScript Node.js backend for AI-powered bug analysis using OpenAI and GitHub integration.

## Prerequisites

- **Node.js**: >= 22.6.0 (required for `--experimental-strip-types` support)
- **API Keys**: GitHub Token and OpenAI API Key

## Getting Started

1. Clone the repository:
```bash
git clone <repository-url>
cd ai-bug-finder-backend
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
```
GITHUB_TOKEN=your_github_token_here
OPENAI_API_KEY=your_openai_api_key_here
```

4. Start the server:
```bash
pnpm start
```

The backend will run on `http://localhost:3001` and serve the frontend at `http://localhost:3000`.