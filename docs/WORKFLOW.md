# How the translation workflow works

You keep writing your product's original text. EveryLocale prepares the other languages and lets your app use a complete approved result. Here is what happens to one message.

## From a change to a release

1. **Import:** your build (`everylocale sync`), the workspace or a connector sends the original text. Import alone makes no model request.
2. **Translate:** a generation model receives the changed text, its context, your terminology and the target language. Messages whose policy says a person translates are never sent to a model; they wait for a person or an import.
3. **Check:** EveryLocale verifies formatting, variables, protected terms, links and numbers. A separate AI request reviews meaning and fluency.
4. **Approve:** the message's policy decides. Automatic approval accepts clean results; human approval waits for a person. Material findings need attention either way.
5. **Deliver:** your build downloads approved files (`everylocale pull`), or a publishing connector updates the destination. Visitors see prepared translations without waiting for a model.

For example, `Welcome, {name}!` can become `Willkommen, {name}!`. The greeting changes; the variable your app replaces with a person's name stays intact.

## What the workspace words mean

| Word | Meaning |
| --- | --- |
| Project | One product's text, language choices, approval policies, and spending limit. |
| Source | The original text you write, usually English. |
| Segment | One piece of text, such as a message or paragraph. A document contains several segments. |
| Namespace | A stable name such as `app` or `help/billing`, usually the file's path. Message ids take the form `namespace:key`. |
| Catalog | A file containing messages keyed by identifier, with language and approval information. Runtime integrations use it. |
| Revision | The identity of one exact version. Changing source text or translation wording makes a different revision. |
| Release | A complete approved set of language files, verified by checksums, that your app builds and deploys together. |
| Live and draft locales | A live locale must be complete before a release. A draft locale may ship incomplete, showing the original text where a translation is not approved yet. |
| Glossary | Product names and terminology you want kept or translated consistently. |

## What runs automatically

The service processes queued work, reuses unchanged translations, retries temporary provider failures within its limits, and records spending. Under an automatic policy, clean reviewed work becomes approved. When a provider rejects the configured key, account or model, translation pauses. Queued work waits rather than failing against a wrong key, and an alert reports the pause until the owner fixes the settings and resumes. WordPress checks for approved updates on its schedule; a build pipeline requests and downloads them during a release.

The browser workspace starts translation when you choose **Translate changes**. To react to app source changes without opening the workspace, connect the CLI to your build pipeline or use a publishing connector. The service does not watch unrelated folders on your computer.

## What needs attention

| Status | Meaning and next action |
| --- | --- |
| Pending | Waiting for an available worker or budget reservation. |
| Awaiting | The policy needs a person to write this translation. Write it in Review, or import it. |
| Running | A model request or validation step is in progress. |
| Review | Wording is ready to inspect. Follow the findings, or approve it if a human gate is enabled. |
| Approved | This exact translation is eligible for export. |
| Failed | The failure code says why. Fix the cause, then retry. |
| Stale | The original text or guidance changed. Translate the current version. |

Review findings explain possible omissions, meaning changes, terminology, and structure. AI review can be wrong. A reviewer may approve over a nonstructural finding by giving a reason, which the approval history records. Missing variables, damaged markup, and other critical structural failures cannot be overridden.

## Approval policies

A project has an ordered list of policies. The first one that matches a message decides how it is translated and approved. A policy can match a namespace (`marketing/**`), a key (`checkout:pay*`) or a tag set in the config file, such as `legal`. The last policy matches everything.

| Policy | Use it for |
| --- | --- |
| AI translates, approval is automatic | Interface text where a clean review is enough |
| AI translates, a person approves | Marketing and other wording where tone matters |
| A person translates and approves | Legal text, or content that must not be sent to a model |

Locked messages, such as brand names, keep the original text in every language. Existing translations come in with `everylocale import` and follow the same policies as edits in the workspace, so an import never approves what a person would have had to approve.

A project token can be limited to some languages and namespaces. An agency then sees and changes only its own work.

## Changes and manual edits

Approval belongs to the exact original and translated wording. An old approval cannot approve a new sentence. Source changes keep the previous approved publication available until its replacement is approved; explicitly withdrawing source content removes it from public exports and linked publications.

Manual corrections are retained while their source remains unchanged. Saving a correction sends it through independent review again. Changing glossary terms or language guidance also requires a new checked revision. Keep message identifiers and content names stable so EveryLocale can recognize updates.

## Spending and exceptions

A project's budget is a cumulative US dollar limit covering translation and review, not a monthly subscription. The service reserves enough for a job before sending requests and records returned usage. Other work can continue while a temporary reservation is busy; an exhausted limit stops new work visibly. Interrupted requests are accounted conservatively because the provider may already have charged them.

Your provider rates, content length, selected models, and retries determine actual cost. Start with a small real sample. Models receive the content needed to translate or review it, so their data policies matter.

For unattended work, [connect exception alerts](OPERATIONS.md#receive-exception-alerts). Failed requests, blocked reviews, and exhausted budgets should reach the person responsible for the product. Keep the current application deployed while resolving them.
