import { z } from 'zod';
import { ContractError } from '@everylocale/core';
import type { RouteContext } from '../http/context.js';
import { accountsSchema, okSchema, operationsSchema } from '../http/schemas.js';

const accountParams = z.object({ id: z.string().max(200) });

export function operationRoutes({ api, config, store }: RouteContext) {
  api.route(
    {
      method: 'GET',
      path: '/api/v1/operations',
      operationId: 'operations',
      summary: 'Budgets, queues, provider pause and recent events',
      tag: 'Service',
      access: 'owner',
      ownerAction: 'inspect service operations',
      response: operationsSchema,
    },
    () => {
      return {
        ...store.operations(),
        providers: config.providers?.status() ?? null,
        events: store.deliveryEvents(),
      };
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/providers/resume',
      operationId: 'resumeProviders',
      summary: 'Resume translation after a provider configuration failure',
      tag: 'Service',
      access: 'owner',
      ownerAction: 'resume translation providers',
      response: okSchema,
    },
    () => {
      config.providers?.resume();
      return { ok: true as const };
    },
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/deliveries/{id}/retry',
      operationId: 'retryDelivery',
      summary: 'Retry a webhook delivery that gave up',
      tag: 'Service',
      access: 'owner',
      ownerAction: 'retry delivery',
      params: z.object({ id: z.uuid() }),
      response: okSchema,
    },
    ({ params }) => {
      store.retryDelivery(params.id);
      return { ok: true as const };
    },
  );
  const connection = () => {
    if (!config.connection)
      throw new ContractError('provider_configuration', 'ChatGPT is not configured', 503);
    return config.connection;
  };
  api.route(
    {
      method: 'GET',
      path: '/api/v1/chatgpt/accounts',
      operationId: 'chatGptAccounts',
      summary: 'Connected ChatGPT accounts',
      tag: 'Providers',
      access: 'owner',
      ownerAction: 'inspect provider accounts',
      response: accountsSchema,
    },
    () => {
      return {
        configured: Boolean(config.connection),
        accounts: config.connection?.accounts() ?? [],
        usageUrl: 'https://chatgpt.com/settings/usage',
      };
    },
  );
  api.route(
    {
      method: 'GET',
      path: '/api/v1/chatgpt/accounts/{id}/models',
      operationId: 'chatGptModels',
      summary: 'Models a connected ChatGPT account can use',
      tag: 'Providers',
      access: 'owner',
      ownerAction: 'inspect provider accounts',
      params: accountParams,
      response: z.array(
        z.object({ slug: z.string(), display_name: z.string(), visibility: z.string() }),
      ),
    },
    ({ params }) => connection().models(params.id),
  );
  api.route(
    {
      method: 'POST',
      path: '/api/v1/chatgpt/accounts/{id}/disconnect',
      operationId: 'disconnectChatGpt',
      summary: 'Disconnect a ChatGPT account and revoke its credentials',
      tag: 'Providers',
      access: 'owner',
      ownerAction: 'disconnect provider accounts',
      params: accountParams,
      response: z.object({ revoked: z.boolean() }),
    },
    ({ params }) => connection().disconnect(params.id),
  );
}
