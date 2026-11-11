import { parserAlias } from '@everylocale/runtime/bundler';

/** Client bundles format precompiled messages, so they ship without the ICU parser. */
export default {
  webpack(config, { isServer }) {
    if (!isServer) Object.assign(config.resolve.alias, parserAlias());
    return config;
  },
};
