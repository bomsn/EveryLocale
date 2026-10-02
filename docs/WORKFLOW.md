# How the translation workflow works

You keep writing your product's original text. EveryLocale prepares the other languages and lets your app use a complete approved result. Here is what happens to one message.

## From a change to a release

1. **Import:** your file, app build, or connector sends the original text. Import alone does not make model requests.
2. **Translate:** a generation model receives changed text, its surrounding context, your terminology, and the target language.
3. **Check:** EveryLocale verifies formatting, variables, protected terms, links, and numbers. A separate AI request reviews meaning and fluency.
4. **Approve:** automatic projects accept clean results. Human-review projects wait for a person. Material findings need attention in either mode.
5. **Deliver:** your build downloads approved files, or a publishing connector updates the destination. Visitors see prepared translations without waiting for a model.

For example, `Welcome, {name}!` can become `Willkommen, {name}!`. The greeting changes; the variable your app replaces with a person's name stays intact.

## What the workspace words mean

| Word | Meaning |
| --- | --- |
| Project | One product's text, language choices, approval policy, and spending limit. |
| Source | The original text you write, usually English. |
| Segment | One piece of text, such as a message or paragraph. A document contains several segments. |
| Content name | A stable name such as `messages` or `help-guide`. Reuse it when updating the same document. |
| Catalog | A file containing messages keyed by identifier, with language and approval information. Runtime integrations use it. |
| Revision | The identity of one exact version. Changing source text or translation wording makes a different revision. |
| Release | A complete approved set of language files that your app builds and deploys together. |
| Glossary | Product names and terminology you want kept or translated consistently. |

## What runs automatically

The service processes queued work, reuses unchanged translations, retries temporary provider failures within its limits, and records spending. In automatic mode, clean reviewed work becomes approved. WordPress checks for approved updates on its schedule; a build pipeline requests and downloads them during a release.

The browser workspace starts translation when you choose **Translate changes**. To react to app source changes without opening the workspace, connect the CLI to your build pipeline or use a publishing connector. The service does not watch unrelated folders on your computer.

## What needs attention

| Status | Meaning and next action |
| --- | --- |
| Pending | Waiting for an available worker or budget reservation. |
| Running | A model request or validation step is in progress. |
| Review | Wording is ready to inspect. Follow the findings, or approve it if a human gate is enabled. |
| Approved | This exact translation is eligible for export. |
| Failed | Open the error, fix its cause, then retry. |
| Stale | The original text or guidance changed. Translate the current version. |

Review findings explain possible omissions, meaning changes, terminology, and structure. AI review can be wrong. An owner may approve a nonstructural finding with an explanation recorded in the approval history. Missing variables, damaged markup, and other critical structural failures cannot be overridden.

## Changes and manual edits

Approval belongs to the exact original and translated wording. An old approval cannot approve a new sentence. Source changes keep the previous approved publication available until its replacement is approved; explicitly withdrawing source content removes it from public exports and linked publications.

Manual corrections are retained while their source remains unchanged. Saving a correction sends it through independent review again. Changing glossary terms or language guidance also requires a new checked revision. Keep message identifiers and content names stable so EveryLocale can recognize updates.

## Spending and exceptions

A project's budget is a cumulative US dollar limit covering translation and review, not a monthly subscription. The service reserves enough for a job before sending requests and records returned usage. Other work can continue while a temporary reservation is busy; an exhausted limit stops new work visibly. Interrupted requests are accounted conservatively because the provider may already have charged them.

Your provider rates, content length, selected models, and retries determine actual cost. Start with a small real sample. Models receive the content needed to translate or review it, so their data policies matter.

For unattended work, [connect exception alerts](OPERATIONS.md#receive-exception-alerts). Failed requests, blocked reviews, and exhausted budgets should reach the person responsible for the product. Keep the current application deployed while resolving them.
