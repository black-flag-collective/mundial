import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConfederationLegend } from './ConfederationLegend';

const meta: Meta<typeof ConfederationLegend> = {
  title: 'Globe/ConfederationLegend',
  component: ConfederationLegend
};
export default meta;
type Story = StoryObj<typeof ConfederationLegend>;

export const Default: Story = {};
