import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

describe('Next.js workspace resolution', () => {
  it('maps NodeNext .js source imports to TypeScript under webpack', () => {
    const webpack = nextConfig.webpack;
    expect(webpack).toBeTypeOf('function');
    if (typeof webpack !== 'function') {
      throw new Error('webpack config is required');
    }

    type WebpackArgs = Parameters<typeof webpack>;
    const config = { resolve: {} } as WebpackArgs[0];
    const result = webpack(config, {} as WebpackArgs[1]);

    expect(result.resolve?.extensionAlias?.['.js']).toEqual(['.ts', '.tsx', '.js']);
  });
});
