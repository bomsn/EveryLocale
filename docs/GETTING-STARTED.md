# Translate your first file

This guide takes you from an empty checkout to a translated JSON file. Start on your own computer. Once you have a result, [connect the same workflow to your app](CONNECT.md).

EveryLocale has two parts: a service that runs translations in the background, and a browser workspace where you choose languages and handle anything that needs review. Both run together here. A project groups one product's text, languages, and spending limit.

## 1. Install and create your settings file

Install Node.js 22.16 or later and pnpm 9.15.9, then open a terminal:

```sh
git clone --branch develop https://github.com/bomsn/EveryLocale.git
cd EveryLocale
pnpm install --frozen-lockfile
pnpm build
pnpm run setup
```

Setup creates `.env` in the EveryLocale folder. Open it in a text editor. It contains two generated credentials: `EVERYLOCALE_ADMIN_TOKEN` is your workspace sign-in token; `EVERYLOCALE_SESSION_SECRET` protects browser sessions. Keep the file private.

If installation reports a native SQLite build failure, install the build tools required by your Node.js platform and repeat installation. Use a supported Node version; SQLite needs either its matching prebuilt binary or a compiler.

## 2. Choose the models

One model translates; a separate request reviews its meaning and wording. You can use the same model for both roles or choose different ones. This OpenRouter example uses Claude Sonnet 4.6 for both. You need your own OpenRouter account, API key, and available credit.

Replace the corresponding empty settings in `.env` with these values. Replace `YOUR_OPENROUTER_KEY` in both places with your key:

```dotenv
EVERYLOCALE_GENERATOR_URL=https://openrouter.ai/api/v1
EVERYLOCALE_GENERATOR_KEY=YOUR_OPENROUTER_KEY
EVERYLOCALE_GENERATOR_MODEL=anthropic/claude-sonnet-4.6
EVERYLOCALE_GENERATOR_INPUT_PRICE=3
EVERYLOCALE_GENERATOR_OUTPUT_PRICE=15
EVERYLOCALE_REVIEWER_URL=https://openrouter.ai/api/v1
EVERYLOCALE_REVIEWER_KEY=YOUR_OPENROUTER_KEY
EVERYLOCALE_REVIEWER_MODEL=anthropic/claude-sonnet-4.6
EVERYLOCALE_REVIEWER_INPUT_PRICE=3
EVERYLOCALE_REVIEWER_OUTPUT_PRICE=15
```

Prices are US dollars per million tokens. Check the [model's current rates](https://openrouter.ai/anthropic/claude-sonnet-4.6) and update both roles if they differ. These numbers let EveryLocale reserve a budget before sending a request; they do not change the provider's price. A small initial project budget limits this first trial. Other cloud models, local models, and eligible ChatGPT connections are covered in [configuration](CONFIGURATION.md).

Run the configuration check, then start the service:

```sh
pnpm doctor
pnpm start
```

Doctor checks settings and database integrity without making a paid request. A successful check confirms configuration, not API-key access or translation quality. Those are exercised by your first translation. Keep this terminal running and open [http://localhost:4310](http://localhost:4310) in your browser. Sign in using `EVERYLOCALE_ADMIN_TOKEN` from `.env`.

## 3. Create a small project

Choose **New project**. Name it **My first app**, give it the identifier `first-app`, and keep English as the original language. Select German as the target and clear the other target-language checkboxes for this first trial. Use a US$1 total translation budget for this short example. Select **Automatic approval** and create the project.

Automatic approval means a translation can be downloaded when its structure and AI review pass. Material findings still wait for attention. **Human review** makes every translation wait for your approval.

## 4. Add and translate the sample

Open **Content → Add content** and choose **Use sample messages**, or select `examples/messages.json` from your checkout. Its content is:

```json
{
  "welcome": "Welcome, {name}!",
  "createProject": "Create a project",
  "saved": "Your changes are saved."
}
```

The file chooser selects JSON format. Keep its content name `messages`, then choose **Import content**. Importing stores the English text; it does not start model requests.

Select German for this content and choose **Translate changes**. The job appears in **Review** while the models work. Open a translation to inspect the original, result, and findings. A clean automatic translation becomes approved. If a finding needs attention, correct the wording, save it for another review, and approve it when appropriate. A human-review project requires that approval even when the checks are clean.

## 5. Download the translated file

Return to **Content**, open `messages`, select German, and choose **Download approved**. You receive a JSON document with the same keys and the `{name}` variable preserved. For example, the first value might read `Willkommen, {name}!`. Wording can vary with your model; keys and variables must remain usable by your app.

**Preview** lets you compare the complete original and translation. **Connect → Export approved** downloads a different file: a catalog containing messages plus their approval information, intended for the EveryLocale runtime. Use **Download approved** when you want the original file format.

## 6. Try a change

Change `Create a project` to `Create your first project` in the original file, then import it again with the same content name. Choose **Translate changes**. Only changed text needs new work; unchanged wording is retained. The old approved version stays available until its replacement is approved. Download the updated document once the new version is ready.

## Next: use this in your product

- [Connect a files-based app](CONNECT.md#files-and-builds) and get a translated file from the CLI.
- [Connect React, Remix, or Next.js](CONNECT.md#react-remix-and-nextjs) to display messages in your interface.
- [Add GitHub Actions](CI-CD.md) after the manual workflow works.
- [Prepare hosting, backups, and alerts](OPERATIONS.md) when moving to a server.

## If you get stuck

| What you see | What to do |
| --- | --- |
| `.env already exists` | Open the existing file. Setup deliberately preserves your credentials. |
| Translation is unavailable | Configure both model roles, run `pnpm doctor`, and restart the service. |
| Authentication or model error | Check your provider key, model identifier, credit, and endpoint. Fix the setting, restart, then retry the failed translation in Review. |
| Budget is exhausted | Read the project's recorded spending, increase its total limit if appropriate, and retry. The limit includes both model roles. |
| Waiting for review | Open the findings. Correct material issues; approve clean wording if your project uses a human gate. |
| Download says content is incomplete | Every current segment in that document needs approval in the selected language. Finish Review, then download again. |
