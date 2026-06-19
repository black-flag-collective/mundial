import type { Meta, StoryObj } from '@storybook/react';
import { Flag } from './Flag';

const meta: Meta<typeof Flag> = {
  title: 'Primitives/Flag',
  component: Flag,
  args: { code: 'BRA', size: 'md' }
};
export default meta;
type Story = StoryObj<typeof Flag>;

export const Default: Story = {};
export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <Flag code="BRA" size="sm" />
      <Flag code="ARG" size="md" />
      <Flag code="ENG" size="lg" />
      <Flag code="ESP" size="xl" />
    </div>
  )
};
