import type { Meta, StoryObj } from '@storybook/react';
import { BracketMatch } from './BracketMatch';

const meta: Meta<typeof BracketMatch> = {
  title: 'Bracket/BracketMatch',
  component: BracketMatch,
  decorators: [(S) => <div style={{ width: 180 }}><S /></div>],
  args: {
    teamA: { code: 'ESP', name: 'Spain', winner: true },
    teamB: { code: 'GER', name: 'Germany' }
  }
};
export default meta;
type Story = StoryObj<typeof BracketMatch>;

export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
