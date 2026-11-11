import { parserAlias } from '@everylocale/runtime/bundler';

export default {
  // Release loading reads files and verifies checksums on the server; Node loads it unbundled.
  serverExternalPackages: ['@everylocale/runtime', '@everylocale/core'],
  /** Client bundles format precompiled messages, so they ship without the ICU parser. */
  webpack(config, { isServer }) {
    if (!isServer) Object.assign(config.resolve.alias, parserAlias());
    return config;
  },
};
