import type { Meta, StoryObj } from '@storybook/react';
import { MatchCard } from './MatchCard';

const meta: Meta<typeof MatchCard> = {
  title: 'Matchday/MatchCard',
  component: MatchCard,
  decorators: [(S) => <div style={{ width: 360 }}><S /></div>]
};
export default meta;
type Story = StoryObj<typeof MatchCard>;

export const Final: Story = {
  args: {
    group: 'A', state: 'final', status: 'FT',
    teamA: { code: 'MEX', name: 'Mexico', score: 2 },
    teamB: { code: 'KOR', name: 'South Korea', score: 1 }
  }
};
export const Upcoming: Story = {
  args: {
    group: 'C', state: 'upcoming', status: '9:00 PM ET',
    teamA: { code: 'BRA', name: 'Brazil' },
    teamB: { code: 'HAI', name: 'Haiti' }
  }
};
export const Selected: Story = { args: { ...Final.args, selected: true } };
