import { z } from 'zod';
import { ContractError } from '@everylocale/core';
import type { RouteContext } from '../http/context.js';

export function operationRoutes({ app, auth, config, store }: RouteContext) {
  app.get('/api/v1/operations', async (request) => {
    auth.owner(request, 'inspect service operations');
    return { ...store.operations(), events: store.deliveryEvents() };
  });
  app.post('/api/v1/deliveries/:id/retry', async (request) => {
    auth.owner(request, 'retry delivery');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    store.retryDelivery(id);
    return { ok: true };
  });
  const connection = () => {
    if (!config.connection)
      throw new ContractError('provider_configuration', 'ChatGPT is not configured', 503);
    return config.connection;
  };
  const accountId = (params: unknown) => z.object({ id: z.string().max(200) }).parse(params).id;
  app.get('/api/v1/chatgpt/accounts', async (request) => {
    auth.owner(request, 'inspect provider accounts');
    return {
      configured: Boolean(config.connection),
      accounts: config.connection?.accounts() ?? [],
      usageUrl: 'https://chatgpt.com/settings/usage',
    };
  });
  app.get('/api/v1/chatgpt/accounts/:id/models', async (request) => {
    auth.owner(request, 'inspect provider accounts');
    return connection().models(accountId(request.params));
  });
  app.post('/api/v1/chatgpt/accounts/:id/disconnect', async (request) => {
    auth.owner(request, 'disconnect provider accounts');
    return connection().disconnect(accountId(request.params));
  });
}
