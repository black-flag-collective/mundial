import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // Storybook 9 merged the former addon-essentials (controls, actions,
  // backgrounds, viewport, etc.) into core, so no addons are needed here.
  addons: [],
  framework: { name: '@storybook/react-vite', options: {} }
};

export default config;
